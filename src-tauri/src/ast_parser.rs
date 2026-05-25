use crate::code_graph::{CodeEdge, CodeGraph, CodeNode};
use std::path::Path;
use tree_sitter::{Language, Parser};

fn ts_language() -> Language {
    tree_sitter_typescript::LANGUAGE_TSX.into()
}
fn py_language() -> Language {
    tree_sitter_python::LANGUAGE.into()
}
fn rs_language() -> Language {
    tree_sitter_rust::LANGUAGE.into()
}

fn node_id(file: &str, name: &str, line: usize) -> String {
    format!("{}:{}@{}", file, name, line)
}

fn is_export_ts(node: tree_sitter::Node) -> bool {
    let mut parent = node.parent();
    while let Some(p) = parent {
        if p.kind() == "export_statement" {
            return true;
        }
        parent = p.parent();
    }
    false
}

fn is_pub_rust(node: tree_sitter::Node, content: &str) -> bool {
    let mut parent = node.parent();
    while let Some(p) = parent {
        if p.kind() == "visibility_modifier" {
            let vis = &content[p.start_byte()..p.end_byte()];
            return vis == "pub";
        }
        parent = p.parent();
    }
    false
}

fn get_node_signature(node: tree_sitter::Node, content: &str) -> String {
    let start = node.start_byte();
    let mut end = node.end_byte();
    // Cap at 200 chars
    if end - start > 200 {
        // try to find first { for class/fn, otherwise just take 200 chars
        let sig_part = &content[start..start + 200];
        if let Some(brace_pos) = sig_part.find('{') {
            end = start + brace_pos;
        } else {
            end = start + 200;
        }
    }
    content[start..end].to_string()
}

// ============================================================================
// TypeScript/TSX/JS/JSX parser
// ============================================================================

pub fn parse_typescript_ts(file_path: &str, content: &str) -> Option<CodeGraph> {
    let mut parser = Parser::new();
    parser.set_language(&ts_language()).ok()?;
    let tree = parser.parse(content, None)?;
    let root = tree.root_node();

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    visit_typescript(root, content, file_path, &mut nodes, &mut edges);

    Some(CodeGraph { nodes, edges })
}

fn visit_typescript(
    node: tree_sitter::Node,
    content: &str,
    file_path: &str,
    nodes: &mut Vec<CodeNode>,
    edges: &mut Vec<CodeEdge>,
) {
    let line_num = node.start_position().row as usize + 1;
    let col = node.start_position().column as usize;

    match node.kind() {
        "function_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let sig = get_node_signature(node, content);
                let id = node_id(file_path, name, line_num);
                let kind = if sig.contains('<') {
                    "component"
                } else {
                    "function"
                };
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: kind.into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
                if is_export_ts(node) {
                    edges.push(CodeEdge {
                        from: id.clone(),
                        to: id.clone(),
                        kind: "export".into(),
                    });
                }
            }
        }
        "class_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let sig = get_node_signature(node, content);
                let id = node_id(file_path, name, line_num);
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: "class".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
                if is_export_ts(node) {
                    edges.push(CodeEdge {
                        from: id.clone(),
                        to: id.clone(),
                        kind: "export".into(),
                    });
                }
            }
        }
        "method_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let sig = get_node_signature(node, content);
                let id = node_id(file_path, name, line_num);
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: "method".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
            }
        }
        "interface_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let id = node_id(file_path, name, line_num);
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: "interface".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: format!("interface {}", name),
                    children: vec![],
                });
                if is_export_ts(node) {
                    edges.push(CodeEdge {
                        from: id.clone(),
                        to: id.clone(),
                        kind: "export".into(),
                    });
                }
            }
        }
        "type_alias_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let id = node_id(file_path, name, line_num);
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: "type".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: format!("type {}", name),
                    children: vec![],
                });
                if is_export_ts(node) {
                    edges.push(CodeEdge {
                        from: id.clone(),
                        to: id.clone(),
                        kind: "export".into(),
                    });
                }
            }
        }
        "enum_declaration" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let id = node_id(file_path, name, line_num);
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: "enum".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: format!("enum {}", name),
                    children: vec![],
                });
                if is_export_ts(node) {
                    edges.push(CodeEdge {
                        from: id.clone(),
                        to: id.clone(),
                        kind: "export".into(),
                    });
                }
            }
        }
        "variable_declarator" => {
            // Arrow functions: const name = (...) => { ... }
            if let Some(name_node) = node.child_by_field_name("name") {
                if let Some(value_node) = node.child_by_field_name("value") {
                    if value_node.kind() == "arrow_function" {
                        let name = &content[name_node.start_byte()..name_node.end_byte()];
                        let sig = get_node_signature(node.parent().unwrap_or(node), content);
                        let is_component = sig.contains('<') || sig.contains("JSX");
                        let kind = if is_component {
                            "component"
                        } else {
                            "function"
                        };
                        let id = node_id(file_path, name, line_num);
                        nodes.push(CodeNode {
                            id: id.clone(),
                            kind: kind.into(),
                            name: name.into(),
                            file_path: file_path.into(),
                            line: line_num,
                            col,
                            signature: sig,
                            children: vec![],
                        });
                        if is_export_ts(node) || node.parent().map_or(false, |p| is_export_ts(p)) {
                            edges.push(CodeEdge {
                                from: id.clone(),
                                to: id.clone(),
                                kind: "export".into(),
                            });
                        }
                    }
                }
            }
        }
        "import_statement" => {
            if let Some(source_node) = node.child_by_field_name("source") {
                let source_str = &content[source_node.start_byte()..source_node.end_byte()];
                let module = source_str
                    .trim_matches(|c: char| c == '\'' || c == '"' || c == '"' || c == ';');

                // Named imports: import { a, b } from 'mod'
                for i in 0..node.named_child_count() {
                    if let Some(child) = node.named_child(i) {
                        if child.kind() == "import_clause" {
                            for j in 0..child.named_child_count() {
                                if let Some(inner) = child.named_child(j) {
                                    match inner.kind() {
                                        "named_imports" => {
                                            for k in 0..inner.named_child_count() {
                                                if let Some(spec) = inner.named_child(k) {
                                                    if spec.kind() == "import_specifier" {
                                                        if let Some(spec_name) =
                                                            spec.child_by_field_name("name")
                                                        {
                                                            let name = &content[spec_name
                                                                .start_byte()
                                                                ..spec_name.end_byte()];
                                                            edges.push(CodeEdge {
                                                                from: node_id(
                                                                    file_path,
                                                                    &format!("import:{}", module),
                                                                    line_num,
                                                                ),
                                                                to: format!(
                                                                    "{}:{}@{}",
                                                                    module, name, line_num
                                                                ),
                                                                kind: "imports".into(),
                                                            });
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                        "namespace_import" => {
                                            if let Some(ns_name) = inner.child_by_field_name("name")
                                            {
                                                let name = &content
                                                    [ns_name.start_byte()..ns_name.end_byte()];
                                                nodes.push(CodeNode {
                                                    id: node_id(file_path, name, line_num),
                                                    kind: "import_namespace".into(),
                                                    name: name.into(),
                                                    file_path: file_path.into(),
                                                    line: line_num,
                                                    col: 0,
                                                    signature: format!(
                                                        "import * as {} from {}",
                                                        name, module
                                                    ),
                                                    children: vec![],
                                                });
                                            }
                                        }
                                        "identifier" => {
                                            // Default import: import Foo from 'mod'
                                            let name =
                                                &content[inner.start_byte()..inner.end_byte()];
                                            nodes.push(CodeNode {
                                                id: node_id(file_path, name, line_num),
                                                kind: "import_default".into(),
                                                name: name.into(),
                                                file_path: file_path.into(),
                                                line: line_num,
                                                col: 0,
                                                signature: format!(
                                                    "import {} from {}",
                                                    name, module
                                                ),
                                                children: vec![],
                                            });
                                            edges.push(CodeEdge {
                                                from: node_id(
                                                    file_path,
                                                    &format!("import:{}", module),
                                                    line_num,
                                                ),
                                                to: format!("{}:{}@{}", module, name, line_num),
                                                kind: "imports".into(),
                                            });
                                        }
                                        _ => {}
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        "export_statement" => {
            // export { a, b }
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    if child.kind() == "export_clause" {
                        for j in 0..child.named_child_count() {
                            if let Some(spec) = child.named_child(j) {
                                if spec.kind() == "export_specifier" {
                                    if let Some(spec_name) = spec.child_by_field_name("name") {
                                        let name =
                                            &content[spec_name.start_byte()..spec_name.end_byte()];
                                        let id = node_id(file_path, name, line_num);
                                        edges.push(CodeEdge {
                                            from: id.clone(),
                                            to: id.clone(),
                                            kind: "export".into(),
                                        });
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        _ => {}
    }

    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            visit_typescript(child, content, file_path, nodes, edges);
        }
    }
}

// ============================================================================
// Python parser
// ============================================================================

pub fn parse_python_ts(file_path: &str, content: &str) -> Option<CodeGraph> {
    let mut parser = Parser::new();
    parser.set_language(&py_language()).ok()?;
    let tree = parser.parse(content, None)?;
    let root = tree.root_node();

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    visit_python(root, content, file_path, &mut nodes, &mut edges);

    Some(CodeGraph { nodes, edges })
}

fn visit_python(
    node: tree_sitter::Node,
    content: &str,
    file_path: &str,
    nodes: &mut Vec<CodeNode>,
    edges: &mut Vec<CodeEdge>,
) {
    let line_num = node.start_position().row as usize + 1;
    let col = node.start_position().column as usize;

    match node.kind() {
        "class_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let sig = get_node_signature(node, content);
                nodes.push(CodeNode {
                    id: node_id(file_path, name, line_num),
                    kind: "class".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
            }
        }
        "function_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let sig = get_node_signature(node, content);

                // Check if it's a method (inside a class body)
                let mut is_method = false;
                let mut parent = node.parent();
                while let Some(p) = parent {
                    if p.kind() == "class_definition" {
                        is_method = true;
                        break;
                    }
                    parent = p.parent();
                }

                let kind = if is_method { "method" } else { "function" };
                nodes.push(CodeNode {
                    id: node_id(file_path, name, line_num),
                    kind: kind.into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
            }
        }
        "import_statement" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let module = &content[name_node.start_byte()..name_node.end_byte()];
                nodes.push(CodeNode {
                    id: node_id(file_path, module, line_num),
                    kind: "import".into(),
                    name: module.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col: 0,
                    signature: format!("import {}", module),
                    children: vec![],
                });
            }
        }
        "import_from_statement" => {
            let mut module_name = "";
            if let Some(mod_node) = node.child_by_field_name("module_name") {
                module_name = &content[mod_node.start_byte()..mod_node.end_byte()];
            }
            for i in 0..node.named_child_count() {
                if let Some(child) = node.named_child(i) {
                    match child.kind() {
                        "dotted_name" => {
                            // from foo.bar import baz
                            if module_name.is_empty() {
                                module_name = &content[child.start_byte()..child.end_byte()];
                            }
                        }
                        "aliased_import" => {
                            let mut name = "";
                            if let Some(alias) = child.child_by_field_name("alias") {
                                let alias_str = &content[alias.start_byte()..alias.end_byte()];
                                if !alias_str.is_empty() {
                                    name = alias_str;
                                }
                            }
                            if name.is_empty() {
                                if let Some(orig) = child.child_by_field_name("name") {
                                    name = &content[orig.start_byte()..orig.end_byte()];
                                }
                            }
                            if !name.is_empty() && !module_name.is_empty() {
                                edges.push(CodeEdge {
                                    from: node_id(
                                        file_path,
                                        &format!("import:{}", module_name),
                                        line_num,
                                    ),
                                    to: format!("{}:{}@{}", module_name, name, line_num),
                                    kind: "imports".into(),
                                });
                            }
                        }
                        "identifier" => {
                            let name = &content[child.start_byte()..child.end_byte()];
                            if name != module_name && !module_name.is_empty() {
                                edges.push(CodeEdge {
                                    from: node_id(
                                        file_path,
                                        &format!("import:{}", module_name),
                                        line_num,
                                    ),
                                    to: format!("{}:{}@{}", module_name, name, line_num),
                                    kind: "imports".into(),
                                });
                            }
                        }
                        _ => {}
                    }
                }
            }
        }
        _ => {}
    }

    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            visit_python(child, content, file_path, nodes, edges);
        }
    }
}

// ============================================================================
// Rust parser
// ============================================================================

pub fn parse_rust_ts(file_path: &str, content: &str) -> Option<CodeGraph> {
    let mut parser = Parser::new();
    parser.set_language(&rs_language()).ok()?;
    let tree = parser.parse(content, None)?;
    let root = tree.root_node();

    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    visit_rust(root, content, file_path, &mut nodes, &mut edges);

    Some(CodeGraph { nodes, edges })
}

fn visit_rust(
    node: tree_sitter::Node,
    content: &str,
    file_path: &str,
    nodes: &mut Vec<CodeNode>,
    edges: &mut Vec<CodeEdge>,
) {
    let line_num = node.start_position().row as usize + 1;
    let col = node.start_position().column as usize;

    match node.kind() {
        "function_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let vis = if is_pub_rust(node, content) {
                    "pub "
                } else {
                    ""
                };
                let sig = format!("{}fn {}", vis, name);
                nodes.push(CodeNode {
                    id: node_id(file_path, name, line_num),
                    kind: "function".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
            }
        }
        "struct_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let vis = if is_pub_rust(node, content) {
                    "pub "
                } else {
                    ""
                };
                let sig = format!("{}struct {}", vis, name);
                nodes.push(CodeNode {
                    id: node_id(file_path, name, line_num),
                    kind: "struct".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
            }
        }
        "enum_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let vis = if is_pub_rust(node, content) {
                    "pub "
                } else {
                    ""
                };
                let sig = format!("{}enum {}", vis, name);
                nodes.push(CodeNode {
                    id: node_id(file_path, name, line_num),
                    kind: "enum".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
            }
        }
        "trait_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let vis = if is_pub_rust(node, content) {
                    "pub "
                } else {
                    ""
                };
                let sig = format!("{}trait {}", vis, name);
                nodes.push(CodeNode {
                    id: node_id(file_path, name, line_num),
                    kind: "trait".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
            }
        }
        "impl_item" => {
            let sig = get_node_signature(node, content);
            let mut type_name = "impl";
            if let Some(type_node) = node.child_by_field_name("type") {
                type_name = &content[type_node.start_byte()..type_node.end_byte()];
            }
            nodes.push(CodeNode {
                id: node_id(file_path, &format!("impl_{}", type_name), line_num),
                kind: "impl".into(),
                name: format!("impl {}", type_name),
                file_path: file_path.into(),
                line: line_num,
                col,
                signature: sig,
                children: vec![],
            });
        }
        "mod_item" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                let vis = if is_pub_rust(node, content) {
                    "pub "
                } else {
                    ""
                };
                let sig = format!("{}mod {}", vis, name);
                nodes.push(CodeNode {
                    id: node_id(file_path, name, line_num),
                    kind: "module".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: sig,
                    children: vec![],
                });
            }
        }
        "use_declaration" => {
            let path_str = &content[node.start_byte()..node.end_byte()];
            let path = path_str
                .trim_start_matches("use ")
                .trim_end_matches(';')
                .trim();
            let last = path.split("::").last().unwrap_or(path);
            edges.push(CodeEdge {
                from: node_id(file_path, &format!("use:{}", path), line_num),
                to: node_id(file_path, last, line_num % 100000),
                kind: "imports".into(),
            });
        }
        "macro_definition" => {
            if let Some(name_node) = node.child_by_field_name("name") {
                let name = &content[name_node.start_byte()..name_node.end_byte()];
                nodes.push(CodeNode {
                    id: node_id(file_path, name, line_num),
                    kind: "macro".into(),
                    name: name.into(),
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: format!("macro_rules! {}", name),
                    children: vec![],
                });
            }
        }
        _ => {}
    }

    for i in 0..node.named_child_count() {
        if let Some(child) = node.named_child(i) {
            visit_rust(child, content, file_path, nodes, edges);
        }
    }
}

// ============================================================================
// Language detection
// ============================================================================

pub fn parse_with_ts(file_path: &str, content: &str) -> Option<CodeGraph> {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");
    match ext {
        "ts" | "tsx" | "js" | "jsx" => parse_typescript_ts(file_path, content),
        "py" => parse_python_ts(file_path, content),
        "rs" => parse_rust_ts(file_path, content),
        _ => None,
    }
}

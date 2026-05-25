use std::fs;
use std::path::Path;
use std::time::Duration;

#[derive(serde::Serialize, Clone, Debug)]
pub struct CodeNode {
    pub id: String,
    pub kind: String,
    pub name: String,
    pub file_path: String,
    pub line: usize,
    pub col: usize,
    pub signature: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub children: Vec<String>,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct CodeEdge {
    pub from: String,
    pub to: String,
    pub kind: String,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct CodeGraph {
    pub nodes: Vec<CodeNode>,
    pub edges: Vec<CodeEdge>,
}

fn node_id(file: &str, name: &str, line: usize) -> String {
    format!("{}:{}@{}", file, name, line)
}

/// Extract a word after finding a keyword in a line
fn word_after(line: &str, keyword: &str) -> Option<String> {
    let pos = line.find(keyword)?;
    let after = &line[pos + keyword.len()..];
    let trimmed = after.trim_start();
    if trimmed.is_empty() {
        return None;
    }
    let end = trimmed
        .find(|c: char| !c.is_alphanumeric() && c != '_')
        .unwrap_or(trimmed.len());
    let word = &trimmed[..end];
    if word.is_empty() {
        None
    } else {
        Some(word.to_string())
    }
}

/// Extract content between parentheses after a keyword
fn parens_after(line: &str, keyword: &str) -> Option<String> {
    let pos = line.find(keyword)?;
    let after = &line[pos + keyword.len()..];
    let start = after.find('(')?;
    let remaining = &after[start + 1..];
    let mut depth = 1;
    let mut end = 0;
    for (i, c) in remaining.char_indices() {
        if c == '(' {
            depth += 1;
        }
        if c == ')' {
            depth -= 1;
            if depth == 0 {
                end = i;
                break;
            }
        }
    }
    if depth == 0 {
        Some(remaining[..end].to_string())
    } else {
        None
    }
}

/// Check if the line starts with given prefix after optional export
fn is_export(line: &str) -> bool {
    line.trim_start().starts_with("export ")
}

pub fn parse_file(file_path: &str, content: &str) -> CodeGraph {
    let ext = Path::new(file_path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("");

    // Try tree-sitter AST parsing first
    let ts_result = crate::ast_parser::parse_with_ts(file_path, content);
    if let Some(graph) = ts_result {
        return graph;
    }

    // Fallback to string matching
    match ext {
        "ts" | "tsx" | "js" | "jsx" => parse_typescript(file_path, content),
        "py" => parse_python(file_path, content),
        "rs" => parse_rust(file_path, content),
        _ => CodeGraph {
            nodes: vec![],
            edges: vec![],
        },
    }
}

fn parse_typescript(file_path: &str, content: &str) -> CodeGraph {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let mut current_class: Option<usize> = None;
    let mut brace_depth = 0i32;

    for (line_idx, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        let line_num = line_idx + 1;

        brace_depth += line.matches('{').count() as i32;
        brace_depth -= line.matches('}').count() as i32;
        if brace_depth <= 1 {
            current_class = None;
        }

        // Skip comment lines
        if line.starts_with("//") || line.starts_with("/*") || line.starts_with('*') {
            continue;
        }

        // --- Class ---
        if let Some(name) = word_after(line, "class ") {
            let col = raw_line.find(&name).unwrap_or(0);
            let mut sig = format!("class {}", name);
            if let Some(bases) = parens_after(line, "extends ") {
                sig.push_str(&format!(" extends {}", bases));
            }
            if let Some(ifaces) = parens_after(line, "implements ") {
                sig.push_str(&format!(" implements {}", ifaces));
            }
            let id = node_id(file_path, &name, line_num);
            let idx = nodes.len();
            nodes.push(CodeNode {
                id: id.clone(),
                kind: "class".into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col,
                signature: sig,
                children: vec![],
            });
            if is_export(line) {
                edges.push(CodeEdge {
                    from: id.clone(),
                    to: id.clone(),
                    kind: "export".into(),
                });
            }
            current_class = Some(idx);
        }

        // --- Interface ---
        if let Some(name) = word_after(line, "interface ") {
            let id = node_id(file_path, &name, line_num);
            nodes.push(CodeNode {
                id: id.clone(),
                kind: "interface".into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col: 0,
                signature: format!(
                    "interface {}",
                    word_after(line, "interface ").unwrap_or_default()
                ),
                children: vec![],
            });
            if is_export(line) {
                edges.push(CodeEdge {
                    from: id.clone(),
                    to: id.clone(),
                    kind: "export".into(),
                });
            }
        }

        // --- Type alias ---
        if line.contains("type ") && line.contains('=') {
            if let Some(name) = word_after(line, "type ") {
                let id = node_id(file_path, &name, line_num);
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: "type".into(),
                    name,
                    file_path: file_path.into(),
                    line: line_num,
                    col: 0,
                    signature: format!("type {}", word_after(line, "type ").unwrap_or_default()),
                    children: vec![],
                });
                if is_export(line) {
                    edges.push(CodeEdge {
                        from: id.clone(),
                        to: id.clone(),
                        kind: "export".into(),
                    });
                }
            }
        }

        // --- Enum ---
        if let Some(name) = word_after(line, "enum ") {
            let id = node_id(file_path, &name, line_num);
            nodes.push(CodeNode {
                id: id.clone(),
                kind: "enum".into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col: 0,
                signature: format!("enum {}", word_after(line, "enum ").unwrap_or_default()),
                children: vec![],
            });
            if is_export(line) {
                edges.push(CodeEdge {
                    from: id.clone(),
                    to: id.clone(),
                    kind: "export".into(),
                });
            }
        }

        // --- Functions (standalone, not inside class) ---
        if current_class.is_none() && line.contains("function ") {
            if let Some(name) = word_after(line, "function ") {
                let col = raw_line.find(&name).unwrap_or(0);
                let id = node_id(file_path, &name, line_num);
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: "function".into(),
                    name,
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: format!(
                        "function {}",
                        word_after(line, "function ").unwrap_or_default()
                    ),
                    children: vec![],
                });
                if is_export(line) {
                    edges.push(CodeEdge {
                        from: id.clone(),
                        to: id.clone(),
                        kind: "export".into(),
                    });
                }
            }
        }

        // --- Arrow function const: const name = (...) => ---
        if current_class.is_none()
            && (line.starts_with("const ") || line.starts_with("let ") || line.starts_with("var "))
        {
            let decl = line.trim_start();
            let keyword = if decl.starts_with("const ") {
                "const "
            } else if decl.starts_with("let ") {
                "let "
            } else {
                "var "
            };
            if let Some(name) = word_after(decl, keyword) {
                if decl.contains("=>") && !decl.contains("function ") {
                    let is_component = decl.contains('<') || decl.contains('>');
                    let kind = if is_component {
                        "component"
                    } else {
                        "function"
                    };
                    let id = node_id(file_path, &name, line_num);
                    let col = raw_line.find(&name).unwrap_or(0);
                    nodes.push(CodeNode {
                        id: id.clone(),
                        kind: kind.into(),
                        name,
                        file_path: file_path.into(),
                        line: line_num,
                        col,
                        signature: format!(
                            "{}{} = (...) =>",
                            keyword,
                            word_after(decl, keyword).unwrap_or_default()
                        ),
                        children: vec![],
                    });
                    if is_export(line) {
                        edges.push(CodeEdge {
                            from: id.clone(),
                            to: id.clone(),
                            kind: "export".into(),
                        });
                    }
                }
            }
        }

        // --- TSX function component: function Component() { return <... } ---
        if current_class.is_none() && line.contains("function ") && line.contains('<') {
            if let Some(name) = word_after(line, "function ") {
                let col = raw_line.find(&name).unwrap_or(0);
                let id = node_id(file_path, &name, line_num);
                nodes.push(CodeNode {
                    id: id.clone(),
                    kind: "component".into(),
                    name,
                    file_path: file_path.into(),
                    line: line_num,
                    col,
                    signature: format!(
                        "function {}()",
                        word_after(line, "function ").unwrap_or_default()
                    ),
                    children: vec![],
                });
                if is_export(line) {
                    edges.push(CodeEdge {
                        from: id.clone(),
                        to: id.clone(),
                        kind: "export".into(),
                    });
                }
            }
        }

        // --- import { name } from 'module' ---
        if let Some(after_import) = line.strip_prefix("import ") {
            if after_import.contains(" from ") {
                let parts: Vec<&str> = after_import.splitn(2, " from ").collect();
                let from_part = parts
                    .get(1)
                    .map(|s| s.trim().trim_matches(|c| c == '\'' || c == '"' || c == ';'))
                    .unwrap_or("");
                // Named imports: import { a, b } from ...
                if let Some(braces) = parts[0].find('{') {
                    let after_brace = &parts[0][braces + 1..];
                    if let Some(end) = after_brace.find('}') {
                        for name in after_brace[..end].split(',') {
                            let name = name.trim().trim_matches(|c| c == '\'' || c == '"');
                            if !name.is_empty() {
                                edges.push(CodeEdge {
                                    from: node_id(
                                        file_path,
                                        &format!("import:{}", from_part),
                                        line_num,
                                    ),
                                    to: format!("{}:{}@{}", from_part, name, line_num),
                                    kind: "imports".into(),
                                });
                            }
                        }
                    }
                }
                // import * as name from ...
                if parts[0].contains("* as ") {
                    if let Some(name) = word_after(parts[0], "* as ") {
                        nodes.push(CodeNode {
                            id: node_id(file_path, &name, line_num),
                            kind: "import_namespace".into(),
                            name: name.clone(),
                            file_path: file_path.into(),
                            line: line_num,
                            col: 0,
                            signature: format!("import * as {} from '{}'", name, from_part),
                            children: vec![],
                        });
                    }
                }
                // Default import: import name from ...
                else if !parts[0].contains('{') && !parts[0].contains('*') {
                    if let Some(name) = word_after("import ", line) {
                        nodes.push(CodeNode {
                            id: node_id(file_path, &name, line_num),
                            kind: "import_default".into(),
                            name: name.clone(),
                            file_path: file_path.into(),
                            line: line_num,
                            col: 0,
                            signature: format!("import {} from '{}'", name, from_part),
                            children: vec![],
                        });
                        edges.push(CodeEdge {
                            from: node_id(file_path, &format!("import:{}", from_part), line_num),
                            to: format!("{}:{}@{}", from_part, name, line_num),
                            kind: "imports".into(),
                        });
                    }
                }
            }
        }

        // --- export { name1, name2 } ---
        if line.starts_with("export {") {
            let after = line.strip_prefix("export {").unwrap_or("");
            if let Some(end) = after.find('}') {
                for name in after[..end].split(',') {
                    let name = name
                        .trim()
                        .trim_matches(|c| c == '\'' || c == '"' || c == ';');
                    if !name.is_empty() {
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

        // --- export default ---
        if line.starts_with("export default ") {
            edges.push(CodeEdge {
                from: node_id(file_path, "default", line_num),
                to: node_id(file_path, "default", line_num),
                kind: "export_default".into(),
            });
        }
    }

    CodeGraph { nodes, edges }
}

fn parse_python(file_path: &str, content: &str) -> CodeGraph {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();
    let lines: Vec<&str> = content.lines().collect();

    for (line_idx, raw_line) in lines.iter().enumerate() {
        let line = raw_line.trim();
        let line_num = line_idx + 1;
        if line.starts_with('#') || line.is_empty() {
            continue;
        }

        let indent = raw_line.chars().take_while(|c| c.is_whitespace()).count();
        let decorator = if line_idx > 0 {
            let prev = lines[line_idx - 1].trim();
            if prev.starts_with('@') {
                Some(prev.to_string())
            } else {
                None
            }
        } else {
            None
        };

        if let Some(name) = word_after(line, "class ") {
            let bases = if let Some(before) = line.split(':').nth(1) {
                before.trim().to_string()
            } else {
                String::new()
            };
            let decorator_str = decorator.clone().unwrap_or_default();
            let sig = if !decorator_str.is_empty() {
                format!("@{}\nclass {}({})", decorator_str, name, bases)
            } else if bases.is_empty() {
                format!("class {}", name)
            } else {
                format!("class {}({})", name, bases)
            };
            let col = raw_line.find(&name).unwrap_or(0);
            nodes.push(CodeNode {
                id: node_id(file_path, &name, line_num),
                kind: "class".into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col,
                signature: sig,
                children: vec![],
            });
        }

        if let Some(name) = word_after(line, "def ") {
            let params = if let Some(parens) = line.split('(').nth(1) {
                if let Some(end) = parens.find(')') {
                    parens[..end].to_string()
                } else {
                    String::new()
                }
            } else {
                String::new()
            };
            let sig = if let Some(dec) = decorator {
                format!("@{}\ndef {}({})", dec, name, params)
            } else {
                format!("def {}({})", name, params)
            };
            nodes.push(CodeNode {
                id: node_id(file_path, &name, line_num),
                kind: if indent > 0 { "method" } else { "function" }.into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col: indent,
                signature: sig,
                children: vec![],
            });
        }

        if line.starts_with("from ") {
            if let Some(import_pos) = line.find(" import ") {
                let module = line[5..import_pos].trim();
                let imported = line[import_pos + 8..].trim();
                for name in imported.split(',') {
                    let name = name.trim();
                    if !name.is_empty() {
                        edges.push(CodeEdge {
                            from: node_id(file_path, &format!("import:{}", module), line_num),
                            to: format!("{}:{}@{}", module, name, line_num),
                            kind: "imports".into(),
                        });
                    }
                }
            }
        }

        if line.starts_with("import ") {
            if let Some(module) = word_after(line, "import ") {
                nodes.push(CodeNode {
                    id: node_id(file_path, &module, line_num),
                    kind: "import".into(),
                    name: module.clone(),
                    file_path: file_path.into(),
                    line: line_num,
                    col: 0,
                    signature: format!("import {}", module),
                    children: vec![],
                });
            }
        }
    }

    CodeGraph { nodes, edges }
}

fn parse_rust(file_path: &str, content: &str) -> CodeGraph {
    let mut nodes = Vec::new();
    let mut edges = Vec::new();

    for (line_idx, raw_line) in content.lines().enumerate() {
        let line = raw_line.trim();
        let line_num = line_idx + 1;
        if line.starts_with("//") || line.is_empty() {
            continue;
        }

        let is_pub = line.starts_with("pub ");

        // async fn
        if let Some(name) = word_after(line, "async fn ") {
            if !name.contains('<') {
                let vis = if is_pub { "pub " } else { "" };
                let sig = format!("{}async fn {}", vis, name);
                nodes.push(CodeNode {
                    id: node_id(file_path, &name, line_num),
                    kind: "function".into(),
                    name,
                    file_path: file_path.into(),
                    line: line_num,
                    col: 0,
                    signature: sig,
                    children: vec![],
                });
            }
        }

        if let Some(name) = word_after(line, "fn ") {
            if !name.contains('<') && !name.is_empty() {
                let is_async = raw_line.contains("async");
                let vis = if is_pub { "pub " } else { "" };
                let sig = if is_async {
                    format!("{}async fn {}", vis, name)
                } else {
                    format!("{}fn {}", vis, name)
                };
                nodes.push(CodeNode {
                    id: node_id(file_path, &name, line_num),
                    kind: "function".into(),
                    name,
                    file_path: file_path.into(),
                    line: line_num,
                    col: 0,
                    signature: sig,
                    children: vec![],
                });
            }
        }

        if let Some(name) = word_after(line, "struct ") {
            let vis = if is_pub { "pub " } else { "" };
            let sig = format!("{}struct {}", vis, name);
            nodes.push(CodeNode {
                id: node_id(file_path, &name, line_num),
                kind: "struct".into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col: 0,
                signature: sig,
                children: vec![],
            });
        }

        if let Some(name) = word_after(line, "enum ") {
            let sig = format!("enum {}", name);
            nodes.push(CodeNode {
                id: node_id(file_path, &name, line_num),
                kind: "enum".into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col: 0,
                signature: sig,
                children: vec![],
            });
        }

        if let Some(name) = word_after(line, "trait ") {
            let sig = format!("trait {}", name);
            nodes.push(CodeNode {
                id: node_id(file_path, &name, line_num),
                kind: "trait".into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col: 0,
                signature: sig,
                children: vec![],
            });
        }

        if let Some(name) = word_after(line, "mod ") {
            let sig = format!("mod {}", name);
            nodes.push(CodeNode {
                id: node_id(file_path, &name, line_num),
                kind: "module".into(),
                name,
                file_path: file_path.into(),
                line: line_num,
                col: 0,
                signature: sig,
                children: vec![],
            });
        }

        if line.starts_with("impl ") {
            let after = line[5..].trim();
            nodes.push(CodeNode {
                id: node_id(
                    file_path,
                    &format!("impl_{}", after.split_whitespace().next().unwrap_or("")),
                    line_num,
                ),
                kind: "impl".into(),
                name: format!("impl {}", after),
                file_path: file_path.into(),
                line: line_num,
                col: 0,
                signature: format!("impl {}", after),
                children: vec![],
            });
        }

        if line.starts_with("use ") {
            let path = line[4..].trim_end_matches(';').trim().to_string();
            let last = path.split("::").last().unwrap_or(&path);
            edges.push(CodeEdge {
                from: node_id(file_path, &format!("use:{}", path), line_num),
                to: node_id(file_path, last, line_num % 100000),
                kind: "imports".into(),
            });
        }
    }

    CodeGraph { nodes, edges }
}

pub fn is_ignored_name(name: &str) -> bool {
    name.starts_with('.')
        || name == "node_modules"
        || name == "target"
        || name == "dist"
        || name == "build"
}

/// Walk directory to collect source files with their content
pub fn walk_dir_entries(
    dir: &Path,
    base: &Path,
    entries: &mut Vec<(String, String)>,
) -> std::io::Result<()> {
    if dir.is_dir() {
        for entry in fs::read_dir(dir)? {
            let entry = entry?;
            let path = entry.path();
            let fname = entry.file_name().to_string_lossy().to_string();
            if is_ignored_name(&fname) {
                continue;
            }
            if path.is_dir() {
                walk_dir_entries(&path, base, entries)?;
            } else {
                if let Ok(rel) = path.strip_prefix(base) {
                    let ext = Path::new(&rel)
                        .extension()
                        .and_then(|e| e.to_str())
                        .unwrap_or("");
                    if ["ts", "tsx", "js", "jsx", "py", "rs"].contains(&ext) {
                        if let Ok(content) = fs::read_to_string(&path) {
                            entries.push((rel.to_string_lossy().to_string(), content));
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

pub fn build_code_graph_from_dir(dir: &Path, timeout: Duration) -> CodeGraph {
    let mut entries = Vec::new();
    if walk_dir_entries(dir, dir, &mut entries).is_err() {
        return CodeGraph {
            nodes: vec![],
            edges: vec![],
        };
    }

    let mut all_nodes = Vec::new();
    let mut all_edges = Vec::new();
    let start = std::time::Instant::now();

    for (file_path, content) in entries {
        if start.elapsed() > timeout {
            break;
        }
        let graph = parse_file(&file_path, &content);
        all_nodes.extend(graph.nodes);
        all_edges.extend(graph.edges);
    }

    CodeGraph {
        nodes: all_nodes,
        edges: all_edges,
    }
}

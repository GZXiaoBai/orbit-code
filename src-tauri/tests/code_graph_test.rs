use agent_gui_lib::code_graph::parse_file;

#[test]
fn test_ts_parse_class() {
    let content = "export class UserService {\n  getUser() {}\n}";
    let graph = parse_file("test.ts", content);
    let has_class = graph
        .nodes
        .iter()
        .any(|n| n.kind == "class" && n.name == "UserService");
    assert!(has_class);
    let has_export = graph.edges.iter().any(|e| e.kind == "export");
    assert!(has_export);
}

#[test]
fn test_ts_parse_function() {
    let content = "function helper() { return 1; }";
    let graph = parse_file("test.ts", content);
    let has_fn = graph
        .nodes
        .iter()
        .any(|n| n.kind == "function" && n.name == "helper");
    assert!(has_fn);
}

#[test]
fn test_ts_parse_interface() {
    let content = "export interface Config { key: string }";
    let graph = parse_file("test.ts", content);
    let has_iface = graph
        .nodes
        .iter()
        .any(|n| n.kind == "interface" && n.name == "Config");
    assert!(has_iface);
}

#[test]
fn test_ts_parse_import() {
    let content = "import { useState } from 'react';";
    let graph = parse_file("test.tsx", content);
    let has_import = graph.edges.iter().any(|e| e.kind == "imports");
    assert!(has_import);
}

#[test]
fn test_py_parse_class() {
    let content = "class DataProcessor(BaseProcessor):\n    def process(self):\n        pass";
    let graph = parse_file("test.py", content);
    let has_class = graph
        .nodes
        .iter()
        .any(|n| n.kind == "class" && n.name == "DataProcessor");
    assert!(has_class);
}

#[test]
fn test_py_parse_function() {
    let content = "def calculate_total(items):\n    return sum(items)";
    let graph = parse_file("test.py", content);
    let has_fn = graph
        .nodes
        .iter()
        .any(|n| n.kind == "function" && n.name == "calculate_total");
    assert!(has_fn);
}

#[test]
fn test_rs_parse_fn() {
    let content = "pub fn process_data() -> String { String::new() }";
    let graph = parse_file("test.rs", content);
    let has_fn = graph
        .nodes
        .iter()
        .any(|n| n.kind == "function" && n.name == "process_data");
    assert!(has_fn);
}

#[test]
fn test_rs_parse_struct() {
    let content = "pub struct Config { pub name: String }";
    let graph = parse_file("test.rs", content);
    let has_struct = graph
        .nodes
        .iter()
        .any(|n| n.kind == "struct" && n.name == "Config");
    assert!(has_struct);
}

#[test]
fn test_unknown_extension() {
    let graph = parse_file("test.txt", "hello world");
    assert!(graph.nodes.is_empty());
    assert!(graph.edges.is_empty());
}

#[test]
fn test_empty_content() {
    let graph = parse_file("test.ts", "");
    assert!(graph.nodes.is_empty());
}

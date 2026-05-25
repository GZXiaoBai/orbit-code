use agent_gui_lib::ast_parser::parse_with_ts;

#[test]
fn test_ast_ts_parses_valid_code() {
    let content = "function hello() { return 'world'; }\nclass App {}\n";
    let graph = parse_with_ts("test.ts", content);
    assert!(graph.is_some());
    let g = graph.unwrap();
    assert!(!g.nodes.is_empty());
}

#[test]
fn test_ast_ts_finds_functions() {
    let content = "export function getUser() { return { id: 1 }; }";
    let graph = parse_with_ts("test.ts", content).unwrap();
    let has_fn = graph
        .nodes
        .iter()
        .any(|n| n.kind == "function" && n.name == "getUser");
    assert!(has_fn);
}

#[test]
fn test_ast_invalid_syntax_returns_empty_nodes() {
    let content = "this is not valid typescript {{{";
    let graph = parse_with_ts("test.ts", content);
    assert!(graph.is_some());
    assert!(graph.unwrap().nodes.is_empty());
}

#[test]
fn test_ast_empty_file_returns_empty_nodes() {
    let graph = parse_with_ts("test.ts", "");
    assert!(graph.is_some());
    assert!(graph.unwrap().nodes.is_empty());
}

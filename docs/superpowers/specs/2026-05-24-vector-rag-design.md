# Vector RAG Semantic Code Search — Design Spec

## Goal

用 OpenAI Embeddings API 构建向量语义检索，替换当前 LLM 排序的语义搜索，让 Agent 真正「理解」代码库语义。

## Architecture

```
Agent Loop → gatherTaskContext() → semanticSearch.ts
    ↓                                    ↓
向量检索优先 (Rust)              LLM 排序回退 (no embeddings)
    ↓
SQLite: code_chunks + code_embeddings (blob)
    ↓
Embedding API: text-embedding-3-small (1536d)
    ↓
余弦相似度排序 → Top-K → 注入 LLM 提示词
```

## Data Flow

1. **构建索引**: 扫描源文件 → code_graph 分块 → 调用 embedding API → 存 SQLite
2. **搜索**: 用户 query → 调用 embedding API → 余弦相似度 vs 全部向量 → 排序 Top-K
3. **注入**: 向量结果 + code_graph 符号 + 关键文件内容 → LLM prompt

## Database Design

```sql
code_chunks (id, file_path, start_line, end_line, content, content_hash, symbol_kind, symbol_name)
code_embeddings (id, chunk_id, model, dimensions, embedding_blob)
```

- embedding_blob: float32[1536] = 6144 bytes/blob
- content_hash: SHA-256 for incremental update detection
- symbol_kind/name: from code_graph.rs

## Chunking Strategy

利用 code_graph.rs 符号边界分块，而非固定行数:
- 每个函数/类/接口 = 一个 chunk
- 无符号文件整个文件 = 一个 chunk
- 覆盖整个符号体（从声明到闭合大括号）

## Incremental Update

build_embeddings() 被调用时:
- 扫描 → 比对 content_hash → 新增/更新/删除 三类操作
- 批量 embedding API (batch_size=20)

## Search Algorithm

- 纯 Rust 实现余弦相似度（零外部依赖）
- 搜索时遍历全部向量（500 chunks ≈ <5ms）
- 瓶颈在 API 调用的网络延迟 (~200ms)

## Graceful Degradation

未构建 embedding 时 → 回退到当前 LLM 排序模式

## Scope

- **In scope**: Rust embedding 模块, SQLite 存储, 向量搜索, 前端切换, Sidebar 按钮
- **Out of scope**: tree-sitter AST, 跨平台打包, useWorkspace 拆分, embedding 模型切换

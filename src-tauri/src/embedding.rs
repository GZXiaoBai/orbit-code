use rusqlite::Connection;
use serde::Serialize;
use std::collections::HashSet;

#[derive(Serialize, Clone, Debug)]
pub struct BuildStats {
    pub total_chunks: usize,
    pub new_embeddings: usize,
    pub updated_embeddings: usize,
    pub deleted_chunks: usize,
    pub duration_secs: f64,
}

#[derive(Serialize, Clone, Debug)]
pub struct SearchResult {
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub content_preview: String,
    pub score: f64,
    pub symbol_kind: Option<String>,
    pub symbol_name: Option<String>,
}

/// 从 blob 反序列化为 Vec<f32>
pub fn blob_to_vec(data: &[u8]) -> Vec<f32> {
    data.chunks(4)
        .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
        .collect()
}

/// 将 Vec<f32> 序列化为 blob
pub fn vec_to_blob(v: &[f32]) -> Vec<u8> {
    v.iter().flat_map(|f| f.to_le_bytes()).collect()
}

/// 余弦相似度
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f64 {
    let dot: f64 = a
        .iter()
        .zip(b)
        .map(|(x, y)| (*x as f64) * (*y as f64))
        .sum();
    let na: f64 = a.iter().map(|x| (*x as f64).powi(2)).sum::<f64>().sqrt();
    let nb: f64 = b.iter().map(|x| (*x as f64).powi(2)).sum::<f64>().sqrt();
    if na < 1e-10 || nb < 1e-10 {
        return 0.0;
    }
    dot / (na * nb)
}

pub fn hash_content(content: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(content.as_bytes());
    format!("{:x}", hasher.finalize())
}

#[derive(Clone)]
struct ChunkCandidate {
    file_path: String,
    start_line: usize,
    end_line: usize,
    content: String,
    symbol_kind: Option<String>,
    symbol_name: Option<String>,
}

fn extract_symbol_lines(content: &str, start_line: usize) -> (usize, usize) {
    let lines: Vec<&str> = content.lines().collect();
    let mut end = start_line;
    let mut brace_depth = 0i32;
    let mut started = false;

    for (i, line) in lines.iter().enumerate().skip(start_line.saturating_sub(1)) {
        let line = line.trim();
        brace_depth += line.matches('{').count() as i32;
        brace_depth -= line.matches('}').count() as i32;
        if i + 1 >= start_line {
            started = true;
        }
        if started && brace_depth <= 0 {
            if line.ends_with('}')
                || line.ends_with(';')
                || (brace_depth <= 0 && i + 1 > start_line)
            {
                end = i + 1;
                if line.ends_with('}') || line.ends_with(';') {
                    break;
                }
            }
        }
        end = i + 1;
    }
    (start_line, end.min(lines.len()))
}

/// 扫描工作区，生成 chunks 列表
/// 利用 code_graph.rs 的符号信息按边界分块
fn scan_chunks(workspace_dir: &std::path::Path) -> Result<Vec<ChunkCandidate>, String> {
    let mut candidates = Vec::new();
    let mut entries = Vec::new();
    crate::code_graph::walk_dir_entries(workspace_dir, workspace_dir, &mut entries)
        .map_err(|e| e.to_string())?;

    for (file_path, content) in entries {
        let graph = crate::code_graph::parse_file(&file_path, &content);

        if graph.nodes.is_empty() {
            if content.trim().len() > 50 {
                candidates.push(ChunkCandidate {
                    file_path: file_path.clone(),
                    start_line: 1,
                    end_line: content.lines().count(),
                    content: content.clone(),
                    symbol_kind: None,
                    symbol_name: None,
                });
            }
        } else {
            for node in &graph.nodes {
                let (start_line, end_line) = extract_symbol_lines(&content, node.line);
                let chunk_content = content
                    .lines()
                    .skip(start_line.saturating_sub(1))
                    .take(end_line - start_line + 1)
                    .collect::<Vec<_>>()
                    .join("\n");

                if chunk_content.trim().len() > 20 {
                    candidates.push(ChunkCandidate {
                        file_path: file_path.clone(),
                        start_line,
                        end_line,
                        content: chunk_content,
                        symbol_kind: Some(node.kind.clone()),
                        symbol_name: Some(node.name.clone()),
                    });
                }
            }
        }
    }
    Ok(candidates)
}

/// 调用 embedding API（单个文本）
pub async fn compute_embedding(
    text: &str,
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<Vec<f32>, String> {
    let url = base_url.unwrap_or("https://api.openai.com/v1/embeddings");
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "model": model,
        "input": text,
    });

    let res = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Embedding API failed: {}", e))?;

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let embedding = body["data"][0]["embedding"]
        .as_array()
        .ok_or("No embedding in response")?
        .iter()
        .map(|v| v.as_f64().unwrap_or(0.0) as f32)
        .collect();

    Ok(embedding)
}

/// 批量计算 embeddings
pub async fn compute_embeddings_batch(
    texts: &[String],
    api_key: &str,
    model: &str,
    base_url: Option<&str>,
) -> Result<Vec<Vec<f32>>, String> {
    let url = base_url.unwrap_or("https://api.openai.com/v1/embeddings");
    let client = reqwest::Client::new();

    let payload = if texts.len() == 1 {
        serde_json::json!({ "model": model, "input": texts[0] })
    } else {
        serde_json::json!({ "model": model, "input": texts })
    };

    let res = client
        .post(url)
        .header("Content-Type", "application/json")
        .header("Authorization", format!("Bearer {}", api_key))
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Batch embedding API failed: {}", e))?;

    let body: serde_json::Value = res
        .json()
        .await
        .map_err(|e| format!("JSON parse error: {}", e))?;

    let data = body["data"].as_array().ok_or("No data array in response")?;

    let embeddings: Vec<Vec<f32>> = data
        .iter()
        .map(|item| {
            item["embedding"]
                .as_array()
                .unwrap_or(&vec![])
                .iter()
                .map(|v| v.as_f64().unwrap_or(0.0) as f32)
                .collect()
        })
        .collect();

    Ok(embeddings)
}

/// 全量构建/增量更新 embeddings
pub fn build_all_embeddings(
    conn: &Connection,
    workspace_dir: &std::path::Path,
    api_key: &str,
) -> Result<BuildStats, String> {
    let start = std::time::Instant::now();
    let candidates = scan_chunks(workspace_dir)?;
    let model = "text-embedding-3-small";

    // 1. 删除已不存在的 chunks
    let existing: HashSet<String> = candidates
        .iter()
        .map(|c| format!("{}:{}", c.file_path, c.start_line))
        .collect();

    let mut to_delete = Vec::new();
    {
        let mut stmt = conn
            .prepare("SELECT id, file_path, start_line FROM code_chunks")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, usize>(2)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        for row in rows {
            let (id, fp, sl) = row.map_err(|e| e.to_string())?;
            if !existing.contains(&format!("{}:{}", fp, sl)) {
                to_delete.push(id);
            }
        }
    }

    let deleted = to_delete.len();
    for id in &to_delete {
        conn.execute("DELETE FROM code_embeddings WHERE chunk_id = ?1", [id])
            .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM code_chunks WHERE id = ?1", [id])
            .map_err(|e| e.to_string())?;
    }

    // 2. 筛选需要新建/更新的 chunks（比对 hash）
    let mut to_embed: Vec<(ChunkCandidate, String)> = Vec::new();
    for c in &candidates {
        let hash = hash_content(&c.content);
        let mut existing_hash: Option<String> = None;
        let mut existing_id: Option<String> = None;
        {
            let mut stmt = conn.prepare(
                "SELECT id, content_hash FROM code_chunks WHERE file_path = ?1 AND start_line = ?2"
            ).map_err(|e| e.to_string())?;
            let mut rows = stmt
                .query_map(rusqlite::params![c.file_path, c.start_line as i64], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            if let Some(row) = rows.next() {
                let (eid, ehash) = row.map_err(|e| e.to_string())?;
                existing_id = Some(eid);
                existing_hash = Some(ehash);
            }
        }

        if let Some(ehash) = existing_hash {
            if ehash != hash {
                to_embed.push((c.clone(), existing_id.unwrap()));
            }
        } else {
            let new_id = uuid::Uuid::new_v4().to_string();
            to_embed.push((c.clone(), new_id));
        }
    }

    // 3. 批量调用 embedding API（每批20个）
    let mut new_embeddings = 0usize;
    let mut updated_embeddings = 0usize;

    for batch in to_embed.chunks(20) {
        let texts: Vec<String> = batch.iter().map(|(c, _)| c.content.clone()).collect();

        // Use block_on since this runs in synchronous context from Tauri command thread
        let embeddings =
            tauri::async_runtime::block_on(compute_embeddings_batch(&texts, api_key, model, None))?;

        for ((candidate, chunk_id), embedding) in batch.iter().zip(embeddings) {
            let hash = hash_content(&candidate.content);
            let blob = vec_to_blob(&embedding);
            let embed_id = uuid::Uuid::new_v4().to_string();

            let existing_count: i64 = {
                let mut stmt = conn
                    .prepare("SELECT COUNT(*) FROM code_chunks WHERE id = ?1")
                    .map_err(|e| e.to_string())?;
                stmt.query_row([chunk_id.as_str()], |row| row.get(0))
                    .map_err(|e| e.to_string())?
            };

            if existing_count > 0 {
                conn.execute(
                    "UPDATE code_chunks SET content = ?1, content_hash = ?2, symbol_kind = ?3, symbol_name = ?4, end_line = ?5 WHERE id = ?6",
                    rusqlite::params![candidate.content, hash, candidate.symbol_kind, candidate.symbol_name, candidate.end_line as i64, chunk_id],
                ).map_err(|e| e.to_string())?;
                conn.execute(
                    "UPDATE code_embeddings SET embedding_blob = ?1, model = ?2, dimensions = ?3 WHERE chunk_id = ?4",
                    rusqlite::params![blob, model, embedding.len() as i64, chunk_id],
                ).map_err(|e| e.to_string())?;
                updated_embeddings += 1;
            } else {
                conn.execute(
                    "INSERT INTO code_chunks (id, file_path, start_line, end_line, content, content_hash, symbol_kind, symbol_name) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
                    rusqlite::params![chunk_id, candidate.file_path, candidate.start_line as i64, candidate.end_line as i64, candidate.content, hash, candidate.symbol_kind, candidate.symbol_name],
                ).map_err(|e| e.to_string())?;
                conn.execute(
                    "INSERT INTO code_embeddings (id, chunk_id, model, dimensions, embedding_blob) VALUES (?1,?2,?3,?4,?5)",
                    rusqlite::params![embed_id, chunk_id, model, embedding.len() as i64, blob],
                ).map_err(|e| e.to_string())?;
                new_embeddings += 1;
            }
        }
    }

    Ok(BuildStats {
        total_chunks: candidates.len(),
        new_embeddings,
        updated_embeddings,
        deleted_chunks: deleted,
        duration_secs: start.elapsed().as_secs_f64(),
    })
}

/// 搜索相似代码块
pub fn search_similar(
    conn: &Connection,
    query_embedding: &[f32],
    top_k: usize,
) -> Result<Vec<SearchResult>, String> {
    let mut stmt = conn.prepare(
        "SELECT ce.embedding_blob, cc.file_path, cc.start_line, cc.end_line, cc.content, cc.symbol_kind, cc.symbol_name
         FROM code_embeddings ce
         JOIN code_chunks cc ON ce.chunk_id = cc.id"
    ).map_err(|e| e.to_string())?;

    let mut scored: Vec<(f64, SearchResult)> = Vec::new();

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, Vec<u8>>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, usize>(2)?,
                row.get::<_, usize>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, Option<String>>(6)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (blob, fp, sl, el, content, sk, sn) = row.map_err(|e| e.to_string())?;
        let vec = blob_to_vec(&blob);
        let score = cosine_similarity(query_embedding, &vec);

        let preview: String = content.lines().take(3).collect::<Vec<_>>().join("\n");
        let preview = if preview.len() > 200 {
            format!("{}...", &preview[..200])
        } else {
            preview
        };

        scored.push((
            score,
            SearchResult {
                file_path: fp,
                start_line: sl,
                end_line: el,
                content_preview: preview,
                score,
                symbol_kind: sk,
                symbol_name: sn,
            },
        ));
    }

    scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
    let results: Vec<SearchResult> = scored.into_iter().take(top_k).map(|(_, r)| r).collect();

    Ok(results)
}

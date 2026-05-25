use agent_gui_lib::embedding::{blob_to_vec, cosine_similarity, vec_to_blob};

#[test]
fn test_cosine_identical() {
    let v = vec![1.0_f32, 2.0, 3.0];
    let score = cosine_similarity(&v, &v);
    assert!((score - 1.0).abs() < 0.001);
}

#[test]
fn test_cosine_orthogonal() {
    let a = vec![1.0_f32, 0.0, 0.0];
    let b = vec![0.0_f32, 1.0, 0.0];
    let score = cosine_similarity(&a, &b);
    assert!((score - 0.0).abs() < 0.001);
}

#[test]
fn test_cosine_opposite() {
    let a = vec![1.0_f32, 0.0];
    let b = vec![-1.0_f32, 0.0];
    let score = cosine_similarity(&a, &b);
    assert!((score + 1.0).abs() < 0.001);
}

#[test]
fn test_blob_roundtrip() {
    let original = vec![1.0_f32, -2.5, 3.14, 0.0, 100.0];
    let blob = vec_to_blob(&original);
    let restored = blob_to_vec(&blob);
    assert_eq!(original.len(), restored.len());
    for (a, b) in original.iter().zip(restored.iter()) {
        assert!((a - b).abs() < 0.0001);
    }
}

#[test]
fn test_blob_empty() {
    let original: Vec<f32> = vec![];
    let blob = vec_to_blob(&original);
    let restored = blob_to_vec(&blob);
    assert!(restored.is_empty());
}

#[test]
fn test_cosine_zero_vector() {
    let a = vec![0.0_f32, 0.0, 0.0];
    let b = vec![1.0_f32, 2.0, 3.0];
    let score = cosine_similarity(&a, &b);
    assert_eq!(score, 0.0);
}

pub(crate) fn md5_hash(s: &str) -> u64 {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};

    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::md5_hash;

    #[test]
    fn md5_hash_is_stable_for_same_input() {
        let first = md5_hash("hello world");
        let second = md5_hash("hello world");
        assert_eq!(first, second);
    }

    #[test]
    fn md5_hash_differs_for_different_inputs() {
        let first = md5_hash("hello");
        let second = md5_hash("world");
        assert_ne!(first, second);
    }
}

//! Connection pool for turso database connections.
//!
//! This module provides a thread-safe connection pool that manages multiple
//! database connections. Each thread gets its own connection via `get_conn()`,
//! avoiding concurrent access issues with SQLite.

use std::sync::{Arc, Mutex};
use turso::{Connection, Database};

/// Database wrapper that supports both regular and sync databases.
enum DatabaseType {
    Local(Database),
    Sync(turso::sync::Database),
}

/// A pool of database connections.
///
/// The pool lazily creates connections as needed. Each call to `get_conn()`
/// returns a connection from the pool (or creates a new one if the pool is empty).
/// Connections are returned to the pool when dropped via `PooledConnection`.
#[derive(Clone)]
pub struct ConnectionPool {
    inner: Arc<ConnectionPoolInner>,
}

struct ConnectionPoolInner {
    db: DatabaseType,
    pool: Mutex<Vec<Connection>>,
}

impl ConnectionPool {
    /// Create a new connection pool from a database.
    pub fn new(db: Database) -> Self {
        Self {
            inner: Arc::new(ConnectionPoolInner {
                db: DatabaseType::Local(db),
                pool: Mutex::new(Vec::new()),
            }),
        }
    }

    /// Create a new connection pool from a sync database.
    pub fn new_sync(db: turso::sync::Database) -> Self {
        Self {
            inner: Arc::new(ConnectionPoolInner {
                db: DatabaseType::Sync(db),
                pool: Mutex::new(Vec::new()),
            }),
        }
    }

    /// Get a connection from the pool.
    ///
    /// If the pool has available connections, one is returned.
    /// Otherwise, a new connection is created.
    ///
    /// The returned `PooledConnection` will return the connection to the pool
    /// when dropped.
    pub async fn get_conn(&self) -> anyhow::Result<PooledConnection> {
        let conn = {
            let mut pool = self.inner.pool.lock().unwrap();
            pool.pop()
        };

        let conn = match conn {
            Some(c) => c,
            None => match &self.inner.db {
                DatabaseType::Local(db) => db.connect()?,
                DatabaseType::Sync(db) => db.connect().await?,
            },
        };

        Ok(PooledConnection {
            conn: Some(conn),
            pool: self.inner.clone(),
        })
    }

    /// Get the underlying database reference (for creating additional connections).
    /// Returns None if this is a sync database.
    pub fn database(&self) -> Option<&Database> {
        match &self.inner.db {
            DatabaseType::Local(db) => Some(db),
            DatabaseType::Sync(_) => None,
        }
    }

    /// Get the underlying sync database reference.
    pub fn sync_database(&self) -> Option<&turso::sync::Database> {
        match &self.inner.db {
            DatabaseType::Local(_) => None,
            DatabaseType::Sync(db) => Some(db),
        }
    }
}

/// A connection borrowed from the pool.
///
/// When dropped, the connection is returned to the pool for reuse.
pub struct PooledConnection {
    conn: Option<Connection>,
    pool: Arc<ConnectionPoolInner>,
}

impl PooledConnection {
    /// Get a reference to the underlying connection.
    pub fn connection(&self) -> &Connection {
        self.conn.as_ref().expect("connection already taken")
    }
}

impl std::ops::Deref for PooledConnection {
    type Target = Connection;

    fn deref(&self) -> &Self::Target {
        self.connection()
    }
}

impl Drop for PooledConnection {
    fn drop(&mut self) {
        if let Some(conn) = self.conn.take() {
            let mut pool = self.pool.pool.lock().unwrap();
            pool.push(conn);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use turso::Builder;

    #[tokio::test]
    async fn test_connection_pool_basic() {
        let db = Builder::new_local(":memory:").build().await.unwrap();
        let pool = ConnectionPool::new(db);

        // Get a connection
        let conn = pool.get_conn().await.unwrap();
        assert!(conn.conn.is_some());

        // Drop it
        drop(conn);

        // Get another - should reuse the pooled one
        let conn2 = pool.get_conn().await.unwrap();
        assert!(conn2.conn.is_some());
    }

    #[tokio::test]
    async fn test_connection_pool_concurrent() {
        let db = Builder::new_local(":memory:").build().await.unwrap();
        let pool = ConnectionPool::new(db);

        // Get multiple connections concurrently
        let conn1 = pool.get_conn().await.unwrap();
        let conn2 = pool.get_conn().await.unwrap();
        let conn3 = pool.get_conn().await.unwrap();

        // All should be valid
        assert!(conn1.conn.is_some());
        assert!(conn2.conn.is_some());
        assert!(conn3.conn.is_some());

        // Drop them
        drop(conn1);
        drop(conn2);
        drop(conn3);

        // Pool should now have 3 connections
        let pool_size = pool.inner.pool.lock().unwrap().len();
        assert_eq!(pool_size, 3);
    }
}

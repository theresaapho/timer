const { Pool } = require('pg');

// Chuỗi kết nối an toàn tự động nhận từ Render (Database URL)
const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:your_local_password@localhost:5432/timer_db';

const pool = new Pool({
    connectionString: connectionString,
    ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false // Bật chế độ SSL bảo mật khi chạy trên Render
});

module.exports = {
    query: (text, params) => pool.query(text, params),
    pool: pool
};
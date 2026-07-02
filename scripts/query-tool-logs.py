import sqlite3

conn = sqlite3.connect("/Users/Utkarsh/.codex/logs_2.sqlite")
cursor = conn.cursor()

# Search for mentions of tools, register, or schema
cursor.execute("""
    SELECT id, datetime(ts, 'unixepoch') as date, level, target, feedback_log_body 
    FROM logs 
    WHERE feedback_log_body LIKE '%tool%'
    ORDER BY id DESC 
    LIMIT 100
""")
rows = cursor.fetchall()
print("=================== Tool mentions in logs ===================")
for r in rows:
    # Print only if it contains interesting registration keywords
    body = r[4]
    if any(k in body.lower() for k in ['register', 'schema', 'avail', 'list', 'definition', 'mcp']):
        print(f"[{r[1]}] {r[2]} ({r[3]}): {body[:300]}...")

conn.close()

import sqlite3
import re

conn = sqlite3.connect("/Users/Utkarsh/.codex/logs_2.sqlite")
cursor = conn.cursor()

# Search all logs
cursor.execute("SELECT feedback_log_body FROM logs WHERE feedback_log_body LIKE '%Tool { name:%'")
rows = cursor.fetchall()
all_names = set()
for r in rows:
    names = re.findall(r'Tool\s*{\s*name:\s*"([^"]+)"', r[0])
    for n in names:
        all_names.add(n)

print(f"=================== All Unique Tool Names ({len(all_names)}) ===================")
for n in sorted(list(all_names)):
    print(f"  - {n}")

conn.close()

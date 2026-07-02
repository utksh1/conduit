import sqlite3
import json
import re

conn = sqlite3.connect('/Users/Utkarsh/.codex/logs_2.sqlite')
cursor = conn.cursor()
cursor.execute("SELECT feedback_log_body FROM logs WHERE feedback_log_body LIKE '%function_call%' AND feedback_log_body LIKE '%namespace%' ORDER BY id DESC")
rows = cursor.fetchall()
print(f"Found {len(rows)} rows.")

for i, r in enumerate(rows[:5]):
    text = r[0]
    idx = text.find('namespace')
    if idx != -1:
        print(f"--- ROW {i} ---")
        print(text[max(0, idx-200):min(len(text), idx+1000)])

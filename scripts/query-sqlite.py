import sqlite3
import os
import json

def inspect_db(db_path, name):
    print(f"\n=================== Inspecting {name} ===================")
    if not os.path.exists(db_path):
        print(f"File {db_path} does not exist")
        return
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        
        # Get tables
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [t[0] for t in cursor.fetchall()]
        print("Tables:", ", ".join(tables))
        
        for table in tables:
            # Get count
            cursor.execute(f"SELECT COUNT(*) FROM {table}")
            cnt = cursor.fetchone()[0]
            print(f"  Table '{table}': {cnt} rows")
            
            # Print columns
            cursor.execute(f"PRAGMA table_info({table})")
            cols = [c[1] for c in cursor.fetchall()]
            print(f"    Columns: {', '.join(cols)}")
            
            # Print latest row if it has rows
            if cnt > 0:
                try:
                    cursor.execute(f"SELECT * FROM {table} LIMIT 1")
                    row = cursor.fetchone()
                    print(f"    Sample Row: {row}")
                except Exception as e:
                    print(f"    Error reading sample: {e}")
        conn.close()
    except Exception as e:
        print(f"Error: {e}")

inspect_db("/Users/Utkarsh/.codex/state_5.sqlite", "state_5.sqlite")
inspect_db("/Users/Utkarsh/.codex/logs_2.sqlite", "logs_2.sqlite")

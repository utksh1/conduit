import sqlite3
import re
import json

conn = sqlite3.connect("/Users/Utkarsh/.codex/logs_2.sqlite")
cursor = conn.cursor()

# Search logs for POST request payload and extract tools
cursor.execute("""
    SELECT feedback_log_body 
    FROM logs 
    WHERE feedback_log_body LIKE '%POST to %/responses:%'
    ORDER BY id DESC 
    LIMIT 5
""")
rows = cursor.fetchall()
print("=================== Found Tools list in payload ===================")
for r in rows:
    body = r[0]
    match = re.search(r'POST to \S+:\s*(\{.*\})', body)
    if match:
        try:
            payload = json.loads(match.group(1))
            tools = payload.get("tools", [])
            print(f"Number of tools sent in request: {len(tools)}")
            for idx, t in enumerate(tools):
                t_type = t.get("type", "unknown")
                name = t.get("name") or t.get("function", {}).get("name") or "None"
                print(f"Tool #{idx + 1}: Name={name}, Type={t_type}")
                if t_type == "namespace":
                    print(f"  Namespace keys: {list(t.keys())}")
                    # Print first 3 tool names inside the namespace if any
                    ns_tools = t.get("tools", [])
                    print(f"  Number of tools in namespace: {len(ns_tools)}")
                    for nst in ns_tools[:5]:
                        print(f"    - {nst.get('name')} (type: {nst.get('type')})")
                elif t_type not in ["function", "web_search", "image_generation"]:
                    print("  Raw structure:")
                    print(json.dumps(t, indent=2))
            break
        except Exception as e:
            print("Failed to parse JSON payload:", e)
            print("Snippet:", match.group(1)[:500])

conn.close()

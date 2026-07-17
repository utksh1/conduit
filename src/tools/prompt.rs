use crate::tools::registry::ToolRegistry;
use serde_json::json;

pub fn inject_tool_prompt(registry: &ToolRegistry, mut messages: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let tools = registry.all_definitions();
    
    if tools.is_empty() {
        return messages;
    }

    let mut tool_descriptions = String::from("You have access to the following tools:\n\n");
    
    for tool in tools {
        let schema = serde_json::to_string_pretty(&tool.parameters).unwrap_or_default();
        tool_descriptions.push_str(&format!(
            "Tool: {}\nDescription: {}\nParameters (JSON Schema):\n{}\n\n",
            tool.name, tool.description, schema
        ));
    }

    tool_descriptions.push_str(
        "To use a tool, you MUST reply with exactly this markdown format:\n\
        ```tool_call\n\
        {\n\
          \"tool_calls\": [\n\
            {\n\
              \"id\": \"call_1\",\n\
              \"name\": \"tool_name\",\n\
              \"arguments\": { \"arg1\": \"value1\" }\n\
            }\n\
          ]\n\
        }\n\
        ```\n\
        After I execute the tool, I will reply with the result."
    );

    let system_message = json!({
        "role": "system",
        "content": tool_descriptions
    });

    messages.insert(0, system_message);
    messages
}

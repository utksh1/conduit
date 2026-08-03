use crate::tools::registry::ToolRegistry;
use serde_json::json;

pub fn inject_tool_prompt(registry: &ToolRegistry, mut messages: Vec<serde_json::Value>) -> Vec<serde_json::Value> {
    let tools = registry.all_definitions();
    
    if tools.is_empty() {
        return messages;
    }

    let mut tool_descriptions = String::from("SYSTEM: You are a function-calling assistant. You MUST use tools to answer questions.\n\nAvailable tools:\n");
    
    for tool in tools {
        tool_descriptions.push_str(&format!(
            "- {}: {}\n",
            tool.name, tool.description
        ));
    }

    tool_descriptions.push_str(
        "\nWhen the user asks you to do something, respond ONLY with:\n\
        ```tool_call\n\
        {\"tool_calls\": [{\"id\": \"call_1\", \"name\": \"TOOL_NAME\", \"arguments\": {}}]}\n\
        ```\n\
        Replace TOOL_NAME and arguments. DO NOT write explanations. ONLY the tool_call block."
    );

    let system_message = json!({
        "role": "system",
        "content": tool_descriptions
    });

    messages.insert(0, system_message);
    messages
}

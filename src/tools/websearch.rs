use crate::tools::registry::ToolResult;
use wreq::Client;
use scraper::{Html, Selector};

pub struct WebSearchTool {
    client: Client,
}

impl WebSearchTool {
    pub fn new(client: Client) -> Self {
        Self { client }
    }

    /// Search the web using DuckDuckGo HTML interface
    pub async fn search(&self, query: &str, max_results: usize) -> ToolResult {
        let url = format!(
            "https://html.duckduckgo.com/html/?q={}",
            urlencoding::encode(query)
        );

        let response = match self.client.get(&url)
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .send()
            .await
        {
            Ok(r) => r,
            Err(e) => {
                return ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Failed to fetch search results: {}", e)),
                };
            }
        };

        let html = match response.text().await {
            Ok(h) => h,
            Err(e) => {
                return ToolResult {
                    success: false,
                    output: String::new(),
                    error: Some(format!("Failed to read response body: {}", e)),
                };
            }
        };

        let document = Html::parse_document(&html);
        
        // DuckDuckGo HTML result selectors
        let result_selector = Selector::parse(".result").unwrap_or_else(|_| {
            Selector::parse("div").unwrap()
        });
        let title_selector = Selector::parse(".result__title").unwrap_or_else(|_| {
            Selector::parse("a").unwrap()
        });
        let snippet_selector = Selector::parse(".result__snippet").unwrap_or_else(|_| {
            Selector::parse("p").unwrap()
        });
        let url_selector = Selector::parse(".result__url").unwrap_or_else(|_| {
            Selector::parse("a").unwrap()
        });

        let mut results = Vec::new();
        
        for (idx, result) in document.select(&result_selector).enumerate() {
            if idx >= max_results {
                break;
            }

            let title = result
                .select(&title_selector)
                .next()
                .map(|e| e.text().collect::<String>())
                .unwrap_or_default()
                .trim()
                .to_string();

            let snippet = result
                .select(&snippet_selector)
                .next()
                .map(|e| e.text().collect::<String>())
                .unwrap_or_default()
                .trim()
                .to_string();

            let url = result
                .select(&url_selector)
                .next()
                .and_then(|e| e.value().attr("href"))
                .unwrap_or_default()
                .trim()
                .to_string();

            if !title.is_empty() || !snippet.is_empty() {
                results.push(format!(
                    "Title: {}\nURL: {}\nSnippet: {}\n",
                    title,
                    url,
                    snippet
                ));
            }
        }

        if results.is_empty() {
            return ToolResult {
                success: false,
                output: String::new(),
                error: Some("No search results found".to_string()),
            };
        }

        let output = format!(
            "Search results for \"{}\"\n\n{}",
            query,
            results.join("\n---\n")
        );

        ToolResult {
            success: true,
            output,
            error: None,
        }
    }
}

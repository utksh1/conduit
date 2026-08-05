import { useState } from "react";
import { Image as ImageIcon, Wand2 } from "lucide-react";
import { Button, Input, Spinner } from "@/components/ui";
import ProtectedImage from "@/components/ProtectedImage";
import { dashboardFetch } from "@/lib/dashboard-fetch";

export default function ImageGen() {
  const [prompt, setPrompt] = useState("");
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState("");

  const handleGenerate = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    try {
      const response = await dashboardFetch("/v1/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, n: 1, size: "1024x1024" }),
      });
      const data = await response.json();
      if (data.data?.[0]?.url) setImageUrl(data.data[0].url);
    } catch (error) {
      console.error("Image generation failed:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ImageIcon size={24} />
          Image Generation
        </h1>
        <p className="text-sm text-[var(--color-fg-muted)] mt-1">
          Generate and edit images using AI
        </p>
      </div>

      <div className="bg-[var(--color-surface)] rounded-lg border p-6 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Prompt</label>
          <Input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Describe the image you want to generate..."
            onKeyDown={(e) => e.key === "Enter" && handleGenerate()}
          />
        </div>
        <Button onClick={handleGenerate} disabled={loading || !prompt.trim()}>
          {loading ? <Spinner size={16} /> : <Wand2 size={16} />}
          {loading ? "Generating..." : "Generate Image"}
        </Button>
      </div>

      {imageUrl && (
        <div className="bg-[var(--color-surface)] rounded-lg border p-6">
          <ProtectedImage src={imageUrl} alt="Generated" className="w-full rounded-lg" />
        </div>
      )}
    </div>
  );
}

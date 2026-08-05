import { useEffect, useState } from "react";
import { Spinner } from "@/components/ui";
import { dashboardFetch } from "@/lib/dashboard-fetch";

interface ProtectedImageProps {
  src: string;
  alt: string;
  className?: string;
}

export default function ProtectedImage({ src, alt, className }: ProtectedImageProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    const request = src.startsWith("/v1/") ? dashboardFetch(src) : fetch(src);

    request
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (active && blob) {
          objectUrl = URL.createObjectURL(blob);
          setBlobUrl(objectUrl);
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [src]);

  if (!blobUrl) {
    return (
      <div className="p-4 border rounded mt-2 mb-2 bg-[var(--color-surface)] text-sm flex justify-center items-center h-32">
        <Spinner size={24} />
      </div>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}

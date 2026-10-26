import { useEffect, useState } from "react";

export default function App() {
  const [status, setStatus] = useState("checking server...");

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => setStatus(d.success ? "server connected" : "server error"))
      .catch(() => setStatus("server unreachable"));
  }, []);

  return (
    <main style={{ fontFamily: "system-ui, sans-serif", padding: 32 }}>
      <h1>Tier0</h1>
      <p>{status}</p>
    </main>
  );
}

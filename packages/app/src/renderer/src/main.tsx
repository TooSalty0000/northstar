import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App";
import { HotfixView } from "./views/HotfixView";
import "./global.css";

const qc = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 4000, retry: 1 } },
});

const isHotfix = location.hash.includes("hotfix");

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>{isHotfix ? <HotfixView /> : <App />}</QueryClientProvider>
  </React.StrictMode>,
);

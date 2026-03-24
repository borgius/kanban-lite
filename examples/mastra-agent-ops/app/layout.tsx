import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mastra Agent Ops — kanban-lite",
  description:
    "Supervisor-style Mastra agent orchestration over kanban-lite: intake, planning, and reporting with approval-aware card writes.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

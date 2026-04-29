import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { ArrowLeft, TrendingUp, Target, Zap } from "lucide-react";

const fmtK = (n: number) => {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
};

const BUCKET_COLORS: Record<string, string> = {
  "0.93-0.95": "#f59e0b",
  "0.95-0.97": "#f97316",
  "0.97-0.99": "#ef4444",
  "0.99+":     "#dc2626",
};
const TTE_COLORS: Record<string, string> = {
  "under30s": "#dc2626",
  "30s_2m":   "#f97316",
  "2m_10m":   "#f59e0b",
  "over10m":  "#22c55e",
  "unknown":  "#6b7280",
};
const TTE_LABELS: Record<string, string> = {
  "under30s": "<30s",
  "30s_2m":   "30s–2m",
  "2m_10m":   "2m–10m",
  "over10m":  ">10m",
  "unknown":  "unknown",
};

function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

export default function SportsArb() {
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/sports-nearexpiry"],
    refetchInterval: 120_000,
  });
  if (typeof document !== "undefined") document.title = "S3 Analysis · Polytrack";
  const [sortBy, setSortBy] = useState<"price99"|"nearExp"|"score">("score");

  const rawArbers: any[] = data?.sportsArbers ?? [];
  const arbers = [...rawArbers].sort((a, b) => {
    if (sortBy === "price99")  return (b.priceBuckets?.["0.99+"] ?? 0) - (a.priceBuckets?.["0.99+"] ?? 0);
    if (sortBy === "nearExp")  return (b.nearExpiryCount ?? 0) - (a.nearExpiryCount ?? 0);
    return (b.s3Score ?? 0) - (a.s3Score ?? 0);
  });
  const summary = data?.summary ?? {};

  const globalBuckets: Record<string, number> = {
    "0.93-0.95": 0, "0.95-0.97": 0,

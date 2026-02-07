"use client";

import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  ReferenceLine,
  YAxis,
} from "recharts";

export interface StockWidgetProps {
  ticker: string;
  companyName: string;
  price: number;
  change: number;
  changePercent: number;
  currency?: string;
  updatedAt?: string;
  logo?: React.ReactNode;
  chartData?: number[];
  variant?: "solid" | "glass";
  className?: string;
}

function BitcoinLogo() {
  return (
    <svg viewBox="0 0 32 32" className="w-full h-full block" aria-hidden="true">
      <circle cx="16" cy="16" r="16" fill="#F7931A" />
      <path
        fill="white"
        d="M22.5 14.1c.3-2-1.2-3.1-3.3-3.8l.7-2.7-1.7-.4-.7 2.6c-.4-.1-.9-.2-1.4-.3l.7-2.7-1.7-.4-.7 2.7c-.4-.1-.7-.2-1-.2l-2.3-.6-.4 1.8s1.2.3 1.2.3c.7.2.8.6.8 1l-.8 3.2c0 0 .1 0 .2.1h-.2l-1.1 4.5c-.1.2-.3.5-.8.4 0 0-1.2-.3-1.2-.3l-.8 1.9 2.2.5c.4.1.8.2 1.2.3l-.7 2.8 1.7.4.7-2.7c.5.1.9.2 1.4.3l-.7 2.7 1.7.4.7-2.8c2.8.5 4.9.3 5.8-2.2.7-2-.1-3.2-1.5-3.9 1.1-.3 1.9-1 2.1-2.5zm-3.8 5.3c-.5 2-3.9.9-5 .7l.9-3.6c1.1.3 4.6.8 4.1 2.9zm.5-5.4c-.5 1.8-3.3.9-4.2.7l.8-3.2c.9.2 3.9.6 3.4 2.5z"
      />
    </svg>
  );
}

function StockWidget({
  ticker,
  companyName,
  price,
  change,
  changePercent,
  currency = "£",
  updatedAt = "2m ago",
  logo,
  chartData = [],
  variant = "solid",
  className,
}: StockWidgetProps) {
  const isPositive = change >= 0;
  const trendColor = isPositive ? "#22c55e" : "#ef4444";
  const normalizedTicker = ticker.trim().toUpperCase();
  const effectiveLogo =
    logo ?? (normalizedTicker === "BTC" || normalizedTicker === "XBT" ? <BitcoinLogo /> : null);

  const formattedPrice = price.toLocaleString("de-DE", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formattedChange = Math.abs(change).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  const formattedPercent = Math.abs(changePercent).toFixed(2);

  const data = chartData.map((value, index) => ({
    index,
    value,
  }));

  const referenceValue = chartData.length > 0 
    ? chartData.reduce((sum, val) => sum + val, 0) / chartData.length 
    : price;

  return (
    <div className={cn(
      "p-3 space-y-2 rounded-[var(--radius-lg)]",
      variant === "glass" ? "glass" : "bg-surface border border-border",
      className
    )}>
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          {effectiveLogo && (
            <div className="w-6 h-6 flex items-center justify-center">
              {effectiveLogo}
            </div>
          )}
          <div>
            <div className="text-xs font-semibold text-foreground">{ticker}</div>
            <div className="text-xs text-foreground/60">{companyName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-foreground/40">updated</div>
          <div className="text-xs text-foreground/60">{updatedAt}</div>
        </div>
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-bold text-foreground tracking-tight">
          {currency}{formattedPrice}
        </span>
        <div className="flex items-center gap-2">
          <span
            className="text-xs font-medium"
            style={{ color: trendColor }}
          >
            {isPositive ? "+" : "-"}{currency}{formattedChange}
          </span>
          <span
            className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex items-center gap-0.5"
            style={{ backgroundColor: trendColor, color: "white" }}
          >
            {isPositive ? (
              <TrendingUp className="w-2.5 h-2.5" />
            ) : (
              <TrendingDown className="w-2.5 h-2.5" />
            )}
            {formattedPercent}%
          </span>
        </div>
      </div>

      {chartData.length >= 2 && (
        <div className="h-10 -mx-1">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={data}
              margin={{ top: 2, right: 0, left: 0, bottom: 0 }}
            >
              <defs>
                <linearGradient id={`gradient-${ticker}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={trendColor} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={trendColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <YAxis domain={["dataMin", "dataMax"]} hide />
              <ReferenceLine
                y={referenceValue}
                stroke="rgba(255,255,255,0.2)"
                strokeDasharray="3 3"
              />
              <Area
                type="linear"
                dataKey="value"
                stroke={trendColor}
                strokeWidth={1.5}
                fill={`url(#gradient-${ticker})`}
                dot={false}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export { StockWidget };

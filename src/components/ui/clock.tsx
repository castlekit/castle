"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";

export interface ClockProps {
  size?: number;
  variant?: "solid" | "glass";
  className?: string;
}

function Clock({ size = 200, variant = "solid", className }: ClockProps) {
  const [mounted, setMounted] = useState(false);
  const [time, setTime] = useState<Date | null>(null);

  useEffect(() => {
    setMounted(true);
    setTime(new Date());
    const timer = setInterval(() => {
      setTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const seconds = time?.getSeconds() ?? 0;
  const minutes = time?.getMinutes() ?? 0;
  const hours = (time?.getHours() ?? 0) % 12;

  const secondDeg = seconds * 6;
  const minuteDeg = minutes * 6 + seconds * 0.1;
  const hourDeg = hours * 30 + minutes * 0.5;

  const center = size / 2;
  const clockRadius = size * 0.45;

  const ticks = [];
  for (let i = 0; i < 60; i++) {
    const angle = (i * 6 - 90) * (Math.PI / 180);
    const isHour = i % 5 === 0;
    const innerRadius = isHour ? clockRadius * 0.85 : clockRadius * 0.92;
    const outerRadius = clockRadius * 0.98;
    
    const x1 = center + innerRadius * Math.cos(angle);
    const y1 = center + innerRadius * Math.sin(angle);
    const x2 = center + outerRadius * Math.cos(angle);
    const y2 = center + outerRadius * Math.sin(angle);
    
    ticks.push(
      <line
        key={i}
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke="currentColor"
        strokeWidth={isHour ? 1.5 : 0.5}
        className="text-foreground-muted"
      />
    );
  }

  const numerals = [
    { num: "12", angle: -90 },
    { num: "3", angle: 0 },
    { num: "6", angle: 90 },
    { num: "9", angle: 180 },
  ];

  const numeralRadius = clockRadius * 0.7;

  if (!mounted) {
    return (
      <div 
        className={cn(
          "rounded-[20px] shadow-lg select-none",
          variant === "glass" ? "glass" : "bg-surface border border-border",
          className
        )}
        style={{ width: size, height: size }}
      />
    );
  }

  return (
    <div 
      className={cn(
        "rounded-[20px] shadow-lg select-none",
        variant === "glass" ? "glass" : "bg-surface border border-border",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {ticks}
        
        {numerals.map(({ num, angle }) => {
          const rad = angle * (Math.PI / 180);
          const x = center + numeralRadius * Math.cos(rad);
          const y = center + numeralRadius * Math.sin(rad);
          return (
            <text
              key={num}
              x={x}
              y={y}
              textAnchor="middle"
              dominantBaseline="central"
              className="fill-foreground/50 font-sans font-medium"
              style={{ fontSize: size * 0.09 }}
            >
              {num}
            </text>
          );
        })}
        
        <line
          x1={center}
          y1={center - size * 0.06}
          x2={center}
          y2={center - clockRadius * 0.5}
          stroke="currentColor"
          strokeWidth={3}
          strokeLinecap="round"
          className="text-foreground"
          style={{
            transformOrigin: `${center}px ${center}px`,
            transform: `rotate(${hourDeg}deg)`,
          }}
        />
        
        <line
          x1={center}
          y1={center - size * 0.06}
          x2={center}
          y2={center - clockRadius * 0.75}
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          className="text-foreground"
          style={{
            transformOrigin: `${center}px ${center}px`,
            transform: `rotate(${minuteDeg}deg)`,
          }}
        />
        
        <line
          x1={center}
          y1={center + clockRadius * 0.15}
          x2={center}
          y2={center - clockRadius * 0.8}
          stroke="currentColor"
          strokeWidth={1}
          strokeLinecap="round"
          className="text-error"
          style={{
            transformOrigin: `${center}px ${center}px`,
            transform: `rotate(${secondDeg}deg)`,
          }}
        />
        
        <circle
          cx={center}
          cy={center}
          r={size * 0.025}
          className="fill-error"
        />
      </svg>
    </div>
  );
}

export { Clock };

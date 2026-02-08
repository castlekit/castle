"use client";

import { useEffect, useState } from "react";
import { Loader2, Check, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Sidebar } from "@/components/layout/sidebar";
import { UserMenu } from "@/components/layout/user-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SettingsPage() {
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((data) => {
        setDisplayName(data.displayName || "");
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ displayName }),
      });
      if (res.ok) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar variant="solid" />
      <UserMenu className="fixed top-5 right-6 z-50" variant="solid" />

      <div className="ml-[80px] p-8 max-w-2xl">
        <div className="mb-8">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm text-foreground-secondary hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Link>
          <h1 className="text-2xl font-semibold text-foreground">Settings</h1>
          <p className="text-sm text-foreground-secondary mt-1">
            Configure your Castle preferences
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-foreground-secondary" />
          </div>
        ) : (
          <div className="space-y-8">
            {/* Profile section */}
            <div className="panel p-6">
              <h2 className="text-sm font-semibold text-foreground mb-4">
                Profile
              </h2>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-1.5">
                    Display Name
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="Your name"
                      className="max-w-xs"
                    />
                    <Button
                      onClick={handleSave}
                      disabled={saving}
                      size="sm"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : saved ? (
                        <>
                          <Check className="h-4 w-4 mr-1.5" />
                          Saved
                        </>
                      ) : (
                        "Save"
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-foreground-secondary mt-1.5">
                    Shown in chat channel headers and message attribution.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

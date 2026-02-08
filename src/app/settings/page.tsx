"use client";

import { useEffect, useState, useRef } from "react";
import { Loader2, Check, ArrowLeft, Camera, Trash2, User } from "lucide-react";
import Link from "next/link";
import { Sidebar } from "@/components/layout/sidebar";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useUserSettings } from "@/lib/hooks/use-user-settings";

export default function SettingsPage() {
  const { displayName: savedName, avatarUrl: sharedAvatarUrl, isLoading: settingsLoading, refresh } = useUserSettings();
  const [displayName, setDisplayName] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarSaved, setAvatarSaved] = useState(false);
  const [avatarError, setAvatarError] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync from SWR on initial load
  useEffect(() => {
    if (!settingsLoading && !initialized) {
      setDisplayName(savedName);
      setAvatarUrl(sharedAvatarUrl);
      setInitialized(true);
    }
  }, [settingsLoading, savedName, sharedAvatarUrl, initialized]);

  const loading = settingsLoading && !initialized;

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
        refresh();
        setTimeout(() => setSaved(false), 2000);
      }
    } catch {
      // silent
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setAvatarError("");
    setAvatarSaved(false);
    setUploadingAvatar(true);

    try {
      const formData = new FormData();
      formData.append("avatar", file);

      const res = await fetch("/api/settings/avatar", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (res.ok) {
        setAvatarUrl(data.avatar);
        setAvatarSaved(true);
        refresh();
        setTimeout(() => setAvatarSaved(false), 2000);
      } else {
        setAvatarError(data.error || "Upload failed");
      }
    } catch {
      setAvatarError("Upload failed");
    } finally {
      setUploadingAvatar(false);
      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleAvatarRemove = async () => {
    try {
      const res = await fetch("/api/settings/avatar", { method: "DELETE" });
      if (res.ok) {
        setAvatarUrl(null);
        refresh();
      }
    } catch {
      // silent
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Sidebar variant="solid" />

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
              <div className="space-y-6">
                {/* Avatar */}
                <div>
                  <label className="block text-sm font-medium text-foreground-secondary mb-3">
                    Avatar
                  </label>
                  <div className="flex items-center gap-4">
                    {/* Avatar preview */}
                    <div className="relative group">
                      <div className="w-20 h-20 rounded-full overflow-hidden bg-surface-hover border-2 border-border flex items-center justify-center">
                        {uploadingAvatar ? (
                          <Loader2 className="h-6 w-6 animate-spin text-foreground-secondary" />
                        ) : avatarUrl ? (
                          <img
                            src={avatarUrl}
                            alt="Your avatar"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <User className="h-8 w-8 text-foreground-secondary" />
                        )}
                      </div>
                      {/* Hover overlay */}
                      <button
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploadingAvatar}
                        className="absolute inset-0 w-20 h-20 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer"
                      >
                        <Camera className="h-5 w-5 text-white" />
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => fileInputRef.current?.click()}
                          disabled={uploadingAvatar}
                        >
                          {avatarUrl ? "Change" : "Upload"}
                        </Button>
                        {avatarUrl && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleAvatarRemove}
                            className="text-foreground-secondary hover:text-red-400"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                      <p className="text-xs text-foreground-secondary">
                        PNG, JPEG, WebP, or GIF. Max 5MB. Resized to 256x256.
                      </p>
                      {avatarSaved && (
                        <p className="text-xs text-green-400 flex items-center gap-1">
                          <Check className="h-3 w-3" />
                          Avatar saved
                        </p>
                      )}
                      {avatarError && (
                        <p className="text-xs text-red-400">{avatarError}</p>
                      )}
                    </div>
                  </div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={handleAvatarUpload}
                    className="hidden"
                  />
                </div>

                {/* Display Name */}
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

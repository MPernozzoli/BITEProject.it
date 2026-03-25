import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { X, Plus } from "lucide-react";
import ProfileCard from "./ProfileCard";

interface Profile {
  id: string;
  name: string;
  avatar_url: string | null;
  email: string;
}

interface AuthorSelectorProps {
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}

const AuthorSelector = ({ selectedIds, onChange }: AuthorSelectorProps) => {
  const [profiles, setProfiles] = useState<Profile[]>([]);

  useEffect(() => {
    const fetchProfiles = async () => {
      const { data } = await supabase.from("profiles").select("id, name, avatar_url, email");
      if (data) setProfiles(data);
    };
    fetchProfiles();
  }, []);

  const selected = profiles.filter((p) => selectedIds.includes(p.id));
  const available = profiles.filter((p) => !selectedIds.includes(p.id));

  return (
    <div>
      <label className="text-xs font-sans tracking-[0.2em] uppercase text-muted-foreground mb-2 block">
        Authors
      </label>
      <div className="space-y-2">
        {selected.map((p) => (
          <div key={p.id} className="flex items-center justify-between border border-border px-3 py-2">
            <ProfileCard name={p.name || p.email} avatarUrl={p.avatar_url || undefined} size="sm" />
            <button onClick={() => onChange(selectedIds.filter((id) => id !== p.id))} className="text-muted-foreground hover:text-destructive">
              <X size={14} />
            </button>
          </div>
        ))}
        {available.length > 0 && (
          <select
            value=""
            onChange={(e) => {
              if (e.target.value) onChange([...selectedIds, e.target.value]);
            }}
            className="w-full bg-transparent border border-dashed border-border px-3 py-2 text-sm font-sans text-muted-foreground focus:outline-none focus:border-accent transition-colors"
          >
            <option value="">+ Add author...</option>
            {available.map((p) => (
              <option key={p.id} value={p.id}>{p.name || p.email}</option>
            ))}
          </select>
        )}
      </div>
    </div>
  );
};

export default AuthorSelector;

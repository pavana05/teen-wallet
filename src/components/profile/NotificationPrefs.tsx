import { useEffect, useState } from "react";
import { Bell, MessageSquare, Mail, ShieldCheck, KeyRound, Megaphone, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface NotifPrefs {
  sms_payments: boolean;
  email_payments: boolean;
  sms_otp: boolean;
  email_otp: boolean;
  sms_kyc: boolean;
  email_kyc: boolean;
  push_marketing: boolean;
}

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  sms_payments: true,
  email_payments: true,
  sms_otp: true,
  email_otp: false,
  sms_kyc: true,
  email_kyc: true,
  push_marketing: false,
};

interface Props {
  userId: string | null;
  initial: NotifPrefs;
  email: string | null;
}

interface Channel {
  key: keyof NotifPrefs;
  channel: "SMS" | "Email" | "Push";
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

interface Group {
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  channels: Channel[];
}

const GROUPS: Group[] = [
  {
    title: "Payments",
    desc: "Money received, money sent, low-balance and refund updates.",
    icon: Bell,
    channels: [
      { key: "sms_payments", channel: "SMS", icon: MessageSquare },
      { key: "email_payments", channel: "Email", icon: Mail },
    ],
  },
  {
    title: "OTP & login",
    desc: "One-time passwords and login alerts on new devices.",
    icon: KeyRound,
    channels: [
      { key: "sms_otp", channel: "SMS", icon: MessageSquare },
      { key: "email_otp", channel: "Email", icon: Mail },
    ],
  },
  {
    title: "KYC updates",
    desc: "Document review, verification and rejection notices.",
    icon: ShieldCheck,
    channels: [
      { key: "sms_kyc", channel: "SMS", icon: MessageSquare },
      { key: "email_kyc", channel: "Email", icon: Mail },
    ],
  },
  {
    title: "Marketing & offers",
    desc: "Cashback drops, partner deals and product news.",
    icon: Megaphone,
    channels: [{ key: "push_marketing", channel: "Push", icon: Bell }],
  },
];

export function NotificationPrefs({ userId, initial, email }: Props) {
  const [prefs, setPrefs] = useState<NotifPrefs>(initial);
  const [savingKey, setSavingKey] = useState<keyof NotifPrefs | null>(null);

  useEffect(() => { setPrefs(initial); }, [initial]);

  async function toggle(key: keyof NotifPrefs) {
    if (!userId) {
      toast.error("Please sign in again to save preferences.");
      return;
    }
    const isEmailToggle = key.startsWith("email_");
    if (isEmailToggle && !prefs[key] && !email) {
      toast.error("Add an email address first", { description: "Tap your name to add an email, then enable email alerts." });
      return;
    }
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setSavingKey(key);
    const { error } = await supabase.from("profiles").update({ notif_prefs: next }).eq("id", userId);
    setSavingKey(null);
    if (error) {
      setPrefs(prefs); // revert
      toast.error("Couldn't save preference", { description: error.message });
    }
  }

  return (
    <div className="pp-card divide-y divide-white/5">
      {GROUPS.map((g) => (
        <div key={g.title} className="px-3.5 py-3.5">
          <div className="flex items-start gap-3">
            <div className="pp-row-icon"><g.icon className="w-4 h-4 text-white/85" strokeWidth={2} /></div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] text-white font-medium">{g.title}</p>
              <p className="text-[11.5px] text-white/55 mt-0.5 leading-snug">{g.desc}</p>
            </div>
          </div>
          <div className="mt-3 ml-12 grid gap-2">
            {g.channels.map((c) => {
              const on = prefs[c.key];
              const saving = savingKey === c.key;
              return (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => toggle(c.key)}
                  aria-pressed={on}
                  disabled={saving}
                  className={`pp-prefchip ${on ? "pp-prefchip-on" : ""}`}
                >
                  <c.icon className="w-3.5 h-3.5" strokeWidth={2.2} />
                  <span className="text-[11.5px] font-medium">{c.channel}</span>
                  <span className="ml-auto text-[10.5px] tracking-wider uppercase opacity-80">
                    {saving ? <Loader2 className="w-3 h-3 animate-spin inline" /> : on ? "On" : "Off"}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useState } from "react";
import { KeyRound, LockKeyhole } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Language = "ar" | "en";

export function AccountSecurity({ language, email }: { language: Language; email?: string | null }) {
  const ar = language === "ar";
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const utils = trpc.useUtils();
  const change = trpc.auth.changePassword.useMutation({
    onSuccess: async () => {
      setCurrentPassword(""); setNewPassword(""); setConfirmation("");
      toast.success(ar ? "تم تغيير كلمة المرور. سجّل الدخول مجددًا لمتابعة العمل." : "Password changed. Please sign in again to continue.");
      await utils.auth.me.invalidate();
    },
  });
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (newPassword !== confirmation) { toast.error(ar ? "تأكيد كلمة المرور غير مطابق." : "Password confirmation does not match."); return; }
    change.mutate({ currentPassword, newPassword });
  };
  return <section className="account-security page-enter">
    <header className="page-topline"><div><span className="eyebrow">{ar ? "أمان الحساب" : "ACCOUNT SECURITY"}</span><h1>{ar ? "كلمة المرور والوصول" : "Password & access"}</h1><p>{ar ? "غيّر كلمة مرور حسابك المحلي. ستبقى بيانات المختبر وسجلات الفحوصات مرتبطة بحسابك نفسه." : "Change the password for your local account. Your laboratory records remain attached to the same account."}</p></div><div className="page-topline-icon"><LockKeyhole size={25} /></div></header>
    <div className="account-security-grid"><section className="security-info-card"><KeyRound size={22} /><h2>{ar ? "حسابك المحلي" : "Your local account"}</h2><strong>{email ?? "—"}</strong><p>{ar ? "استخدم كلمة مرور لا تقل عن 8 أحرف، ولا تشاركها مع أي شخص." : "Use at least 8 characters and do not share your password with anyone."}</p></section><form className="security-form-card" onSubmit={submit}><div className="user-card-title"><KeyRound size={20} /><div><span className="eyebrow">{ar ? "تحديث آمن" : "SECURE UPDATE"}</span><h2>{ar ? "تغيير كلمة المرور" : "Change password"}</h2></div></div><label className="field"><span>{ar ? "كلمة المرور الحالية" : "Current password"}</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label><label className="field"><span>{ar ? "كلمة المرور الجديدة" : "New password"}</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></label><label className="field"><span>{ar ? "تأكيد كلمة المرور الجديدة" : "Confirm new password"}</span><input type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required /></label>{change.error && <p className="login-error">{ar ? "تعذر تغيير كلمة المرور. تحقق من كلمة المرور الحالية." : "Password could not be changed. Verify the current password."}</p>}<button type="submit" className="primary-button" disabled={change.isPending}><LockKeyhole size={16} /> {ar ? "حفظ كلمة المرور الجديدة" : "Save new password"}</button></form></div>
  </section>;
}

import { useState } from "react";
import { KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

export function LocalLogin({ language }: { language: "ar" | "en" }) {
  const [email, setEmail] = useState("tadkrah@gmail.com");
  const [password, setPassword] = useState("");
  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
    },
  });
  const isArabic = language === "ar";

  return <main className="local-login-shell" dir={isArabic ? "rtl" : "ltr"}>
    <section className="local-login-card">
      <img src="/manus-storage/yemen-qc-official-header-logo_68fac21a.png" alt="National Quality Control Laboratory seal" />
      <span className="eyebrow">{isArabic ? "دخول محمي" : "Protected access"}</span>
      <h1>{isArabic ? "نظام التحقق المخبري" : "Laboratory validation system"}</h1>
      <p>{isArabic ? "سجّل الدخول للوصول إلى السجلات والتحقق والاعتماد وفق دورك." : "Sign in to access controlled records, validation, and approval according to your role."}</p>
      <form onSubmit={(event) => { event.preventDefault(); login.mutate({ email, password }); }}>
        <label><span>{isArabic ? "البريد الإلكتروني" : "Email"}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></label>
        <label><span>{isArabic ? "كلمة المرور" : "Password"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></label>
        {login.error && <p className="login-error">{isArabic ? "تعذر تسجيل الدخول. راجع البريد وكلمة المرور." : "Sign-in failed. Check the email and password."}</p>}
        <button className="primary-button login-submit" disabled={login.isPending} type="submit"><LogIn size={17} /> {login.isPending ? (isArabic ? "جارٍ التحقق..." : "Signing in...") : (isArabic ? "تسجيل الدخول" : "Sign in")}</button>
      </form>
      <div className="login-note"><KeyRound size={15} /><span>{isArabic ? "حساب المدير الابتدائي: tadkrah@gmail.com" : "Initial administrator: tadkrah@gmail.com"}</span></div>
      <div className="login-security"><ShieldCheck size={15} /><span>{isArabic ? "صلاحياتك تحدد ما يمكنك عرضه أو تعديله أو اعتماده." : "Your role controls what you can view, edit, and approve."}</span></div>
    </section>
  </main>;
}

import { useState } from "react";
import { KeyRound, LogIn, MailCheck, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";

export function LocalLogin({ language }: { language: "ar" | "en" }) {
  const [email, setEmail] = useState("tadkrah@gmail.com");
  const [password, setPassword] = useState("");
  const [forgotPassword, setForgotPassword] = useState(false);
  const [recoveryPassword, setRecoveryPassword] = useState("");
  const [recoveryConfirmation, setRecoveryConfirmation] = useState("");
  const utils = trpc.useUtils();
  const login = trpc.auth.login.useMutation({
    onSuccess: async () => {
      await utils.auth.me.invalidate();
    },
  });
  const isArabic = language === "ar";
  const recoveryToken = typeof window === "undefined" ? null : new URLSearchParams(window.location.hash.slice(1)).get("access_token");
  const requestRecovery = trpc.auth.requestPasswordRecovery.useMutation();
  const completeRecovery = trpc.auth.completePasswordRecovery.useMutation({ onSuccess: () => { window.history.replaceState({}, document.title, window.location.pathname); setRecoveryPassword(""); setRecoveryConfirmation(""); setForgotPassword(false); } });

  if (recoveryToken) return <main className="local-login-shell" dir={isArabic ? "rtl" : "ltr"}><section className="local-login-card"><img src="/manus-storage/yemen-qc-official-header-logo_68fac21a.png" alt="National Quality Control Laboratory seal" /><span className="eyebrow">{isArabic ? "استعادة آمنة" : "SECURE RECOVERY"}</span><h1>{isArabic ? "تعيين كلمة مرور جديدة" : "Set a new password"}</h1><p>{isArabic ? "أدخل كلمة مرور جديدة لإكمال استعادة حسابك." : "Enter a new password to complete account recovery."}</p><form onSubmit={(event) => { event.preventDefault(); if (recoveryPassword !== recoveryConfirmation) return; completeRecovery.mutate({ recoveryToken, newPassword: recoveryPassword }); }}><label><span>{isArabic ? "كلمة المرور الجديدة" : "New password"}</span><input type="password" autoComplete="new-password" minLength={8} value={recoveryPassword} onChange={(event) => setRecoveryPassword(event.target.value)} required /></label><label><span>{isArabic ? "تأكيد كلمة المرور" : "Confirm password"}</span><input type="password" autoComplete="new-password" minLength={8} value={recoveryConfirmation} onChange={(event) => setRecoveryConfirmation(event.target.value)} required /></label>{recoveryPassword !== recoveryConfirmation && recoveryConfirmation && <p className="login-error">{isArabic ? "تأكيد كلمة المرور غير مطابق." : "Password confirmation does not match."}</p>}{completeRecovery.error && <p className="login-error">{isArabic ? "رابط الاستعادة غير صالح أو انتهت صلاحيته." : "The recovery link is invalid or expired."}</p>}<button className="primary-button login-submit" disabled={completeRecovery.isPending || recoveryPassword !== recoveryConfirmation} type="submit"><KeyRound size={17} /> {isArabic ? "حفظ كلمة المرور" : "Save password"}</button></form></section></main>;

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
      <div className="login-recovery"><button type="button" className="link-button" onClick={() => setForgotPassword((current) => !current)}>{isArabic ? "هل نسيت كلمة المرور؟" : "Forgot your password?"}</button>{forgotPassword && <form onSubmit={(event) => { event.preventDefault(); requestRecovery.mutate({ email }); }}><p>{isArabic ? "سنرسل رابط استعادة آمنًا إلى بريدك الإلكتروني المسجل." : "We will send a secure recovery link to your registered email."}</p><button type="submit" className="secondary-button" disabled={requestRecovery.isPending}><MailCheck size={16} /> {requestRecovery.isPending ? (isArabic ? "جارٍ الإرسال..." : "Sending...") : (isArabic ? "إرسال رابط الاستعادة" : "Send recovery link")}</button>{requestRecovery.isSuccess && <p className="recovery-success">{isArabic ? "إذا كان البريد مسجلاً، فقد تم إرسال رابط الاستعادة." : "If the email is registered, a recovery link has been sent."}</p>}{requestRecovery.error && <p className="login-error">{isArabic ? "تعذر بدء الاستعادة. تواصل مع مدير النظام عند استمرار المشكلة." : "Recovery could not be started. Contact the system administrator if the issue persists."}</p>}</form>}</div>
      <div className="login-note"><KeyRound size={15} /><span>{isArabic ? "حساب المدير الابتدائي: tadkrah@gmail.com" : "Initial administrator: tadkrah@gmail.com"}</span></div>
      <div className="login-security"><ShieldCheck size={15} /><span>{isArabic ? "صلاحياتك تحدد ما يمكنك عرضه أو تعديله أو اعتماده." : "Your role controls what you can view, edit, and approve."}</span></div>
    </section>
  </main>;
}

import { useState } from "react";
import { ShieldPlus, UserCog, Users } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

type Language = "ar" | "en";
type Role = "admin" | "user" | "viewer";

const roleText: Record<Language, Record<Role, string>> = {
  ar: { admin: "مدير", user: "مستخدم", viewer: "عارض" },
  en: { admin: "Admin", user: "User", viewer: "Viewer" },
};

export function UserManagement({ language }: { language: Language }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const utils = trpc.useUtils();
  const users = trpc.users.list.useQuery();
  const create = trpc.users.create.useMutation({ onSuccess: async () => { setEmail(""); setName(""); setPassword(""); await utils.users.list.invalidate(); toast.success(language === "ar" ? "تمت إضافة المستخدم." : "User added."); } });
  const updateRole = trpc.users.updateRole.useMutation({ onSuccess: () => utils.users.list.invalidate() });
  const ar = language === "ar";

  return <section className="user-management page-enter">
    <header className="page-topline"><div><span className="eyebrow">{ar ? "إدارة الوصول" : "Access management"}</span><h1>{ar ? "المستخدمون والأدوار" : "Users & roles"}</h1><p>{ar ? "ينشئ المدير الحسابات ويحدد الصلاحية التشغيلية لكل مستخدم." : "Administrators create accounts and define the operational role for each user."}</p></div><div className="page-topline-icon"><Users size={26} /></div></header>
    <div className="users-grid">
      <form className="user-create-card" onSubmit={(event) => { event.preventDefault(); create.mutate({ email, name, password, role }); }}>
        <div className="user-card-title"><ShieldPlus size={20} /><div><span className="eyebrow">{ar ? "حساب جديد" : "New account"}</span><h2>{ar ? "إضافة مستخدم" : "Add user"}</h2></div></div>
        <label className="field"><span>{ar ? "الاسم" : "Name"}</span><input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} /></label>
        <label className="field"><span>{ar ? "البريد الإلكتروني" : "Email"}</span><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label className="field"><span>{ar ? "كلمة مرور مؤقتة" : "Temporary password"}</span><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={6} /></label>
        <label className="field"><span>{ar ? "الدور" : "Role"}</span><select value={role} onChange={(event) => setRole(event.target.value as Role)}>{(["admin", "user", "viewer"] as Role[]).map((value) => <option key={value} value={value}>{roleText[language][value]}</option>)}</select></label>
        {create.error && <p className="login-error">{ar ? "تعذرت إضافة المستخدم. قد يكون البريد مستخدمًا بالفعل." : "User could not be added. The email may already exist."}</p>}
        <button className="primary-button" type="submit" disabled={create.isPending}><ShieldPlus size={16} /> {ar ? "إضافة المستخدم" : "Add user"}</button>
      </form>
      <section className="users-list-card"><div className="user-card-title"><UserCog size={20} /><div><span className="eyebrow">{ar ? "الحسابات الحالية" : "Current accounts"}</span><h2>{ar ? "الأدوار التشغيلية" : "Operational roles"}</h2></div></div>{users.isLoading ? <p>{ar ? "جارٍ تحميل المستخدمين..." : "Loading users..."}</p> : <div className="users-list">{users.data?.map((user) => <article key={user.id}><div><strong>{user.name ?? user.email}</strong><span>{user.email}</span></div><label><span>{ar ? "الدور" : "Role"}</span><select value={user.role} onChange={(event) => updateRole.mutate({ id: user.id, role: event.target.value as Role })} disabled={updateRole.isPending}>{(["admin", "user", "viewer"] as Role[]).map((value) => <option key={value} value={value}>{roleText[language][value]}</option>)}</select></label></article>)}</div>}</section>
    </div>
    <section className="role-guide"><h2>{ar ? "مصفوفة الصلاحيات" : "Role matrix"}</h2><div><p><strong>Admin</strong><span>{ar ? "إدارة المستخدمين، اعتماد أو رفض السجلات، تعديل الحدود وبيانات الأجهزة." : "Manage users, approve or reject records, and edit limits and instruments."}</span></p><p><strong>User</strong><span>{ar ? "إدخال وحفظ السجلات وتعديل بيانات الأجهزة دون تعديل الحدود أو الاعتماد." : "Enter and save records and edit instrument data, without changing limits or approving."}</span></p><p><strong>Viewer</strong><span>{ar ? "عرض السجلات وبيانات الأجهزة فقط دون تنفيذ أي تعديل." : "View records and instrument data only, without making changes."}</span></p></div>
    </section>
  </section>;
}

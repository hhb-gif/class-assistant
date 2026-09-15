// admin-user —— 班级管家「账号管理」云函数（仅管理员可用）
//
// 前端通过 CloudBase `app.callFunction({ name:"admin-user", data:{...} })` 调用。
//
// 需要配置的环境变量（云函数「环境变量」，绝不写进仓库）：
//   TC_SECRET_ID   腾讯云 CAM 密钥 SecretId（调 tcb 管控面用）
//   TC_SECRET_KEY  腾讯云 CAM 密钥 SecretKey
//   TCB_ENV_ID     CloudBase 环境 ID（class-assistant-d6fw1gdce84d261e）
//   TCB_API_KEY    CloudBase 环境 API Key（经网关 exec-pgsql 读写 users 表用）
//
// ⚠️ 体验版用户上限 3 个，当前已被 administrator / teacher / 20230301 占满，
//    create 现在必然失败（上游报错会原样透传给前端，不吞掉）；需升级套餐后才能建新账号。
//
// 密码规则（CloudBase Auth 约束）：8–32 位、不以特殊字符开头、
//   至少含 小写 / 大写 / 数字 / 符号 ()!@#$%^&*\|?><_- 四类中的三类。
//   => 纯学号（如 20230302）不合法，前端必须先行校验并提示。
//
// 入参：{ action: "probe" | "list" | "create" | "resetPassword", ... }
//   probe         —— 检查环境变量是否齐全
//   list          —— 列出环境用户（管控面 DescribeUserList）
//   create        —— { studentNo, displayName, password }
//   resetPassword —— { uid, password }
// 出参：成功 { ok:true, data? }；失败 { ok:false, code, message }
//
// 鉴权：先确认环境变量齐全，再取调用者 uid 并查 users.role ∈ (admin, superAdmin)，
//       否则返回 { ok:false, code:"FORBIDDEN" }，绝不执行任何管控面调用。
//       备注：环境变量不齐时无法查库鉴权，此时直接返回 NO_CREDENTIAL（不执行任何调用）。
"use strict";

var cloudbase = require("@cloudbase/node-sdk");
var tcbSdk = require("tencentcloud-sdk-nodejs-tcb");

var REGION = "ap-shanghai"; // 环境所在地域（国内站）

function envConf() {
  return {
    secretId: process.env.TC_SECRET_ID || "",
    secretKey: process.env.TC_SECRET_KEY || "",
    envId: process.env.TCB_ENV_ID || "",
    apiKey: process.env.TCB_API_KEY || "",
  };
}

function missingEnv(c) {
  var missing = [];
  if (!c.secretId) missing.push("TC_SECRET_ID");
  if (!c.secretKey) missing.push("TC_SECRET_KEY");
  if (!c.envId) missing.push("TCB_ENV_ID");
  if (!c.apiKey) missing.push("TCB_API_KEY");
  return missing;
}

function fail(code, message) { return { ok: false, code: code, message: message }; }

function errMsg(e) {
  if (!e) return "未知错误";
  return e.message || e.Message || e.code || String(e);
}

// ---------- 管控面客户端（tencentcloud-sdk-nodejs-tcb） ----------
function tcbClient(c) {
  var TcbClient = tcbSdk.tcb.v20180608.Client;
  return new TcbClient({
    credential: { secretId: c.secretId, secretKey: c.secretKey },
    region: REGION,
    profile: { httpProfile: { endpoint: "tcb.tencentcloudapi.com" } },
  });
}

// ---------- 网关 exec-pgsql（参数化占位符，绝不拼接字符串） ----------
async function pgQuery(c, sql, parameters) {
  var url = "https://" + c.envId + ".api.tcloudbasegateway.com/v1/rdb/exec-pgsql";
  var res = await fetch(url, {
    method: "POST",
    headers: { "Authorization": "Bearer " + c.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ sql: sql, parameters: parameters || [], role: "cloudbase_postgres" }),
  });
  var raw = await res.text();
  var parsed = null;
  try { parsed = JSON.parse(raw); } catch (e) { /* 非 JSON 响应 */ }
  if (!res.ok) {
    var m = (parsed && (parsed.message || parsed.error)) || raw.slice(0, 300);
    throw new Error("写库失败（" + res.status + "）：" + m);
  }
  if (parsed && parsed.error) throw new Error("写库失败：" + errMsg(parsed.error));
  if (parsed && parsed.data !== undefined) return parsed.data;
  return parsed;
}

function rowsOf(d) {
  if (d == null) return [];
  if (Array.isArray(d)) return d;
  if (Array.isArray(d.rows)) return d.rows;
  if (Array.isArray(d.data)) return d.data;
  return [];
}

// ---------- 调用者身份与鉴权 ----------
async function callerUid(c) {
  var app = cloudbase.init({ env: c.envId });
  var info = await app.auth().getUserInfo();
  return (info && (info.uid || (info.userInfo && info.userInfo.uid))) || "";
}

async function isAdminUser(c, uid) {
  if (!uid) return false;
  var rows = rowsOf(await pgQuery(c, "select role from public.users where uid = $1", [uid]));
  var role = rows.length ? rows[0].role : "";
  return role === "admin" || role === "superAdmin";
}

// ---------- actions ----------
function actionProbe(c) {
  return { ok: true, data: { envId: c.envId } };
}

async function actionList(c) {
  var client = tcbClient(c);
  var res = await client.DescribeUserList({ EnvId: c.envId, PageNo: 1, PageSize: 100 });
  var list = res.UserList || res.Users || [];
  return {
    ok: true,
    data: {
      total: res.TotalCount != null ? res.TotalCount : list.length,
      users: list.map(function (u) {
        return { name: u.Name || u.NickName || "", uid: u.Uid || "", status: u.Status || "" };
      }),
    },
  };
}

async function actionCreate(c, ev) {
  var studentNo = String(ev.studentNo == null ? "" : ev.studentNo).trim();
  var displayName = String(ev.displayName == null ? "" : ev.displayName).trim();
  var password = String(ev.password == null ? "" : ev.password);
  if (!studentNo || !displayName || !password) {
    return fail("BAD_INPUT", "缺少 studentNo / displayName / password");
  }

  var client = tcbClient(c);
  // Name 取学号，NickName 取姓名；上游报错（体验版超限 / 密码不合规）原样抛出
  var res = await client.CreateUser({
    EnvId: c.envId,
    Name: studentNo,
    Password: password,
    NickName: displayName,
    Description: "学生账号",
  });
  var uid = res.Uid || "";
  if (!uid) return fail("UPSTREAM", "CreateUser 未返回 Uid");

  var mrows = rowsOf(await pgQuery(c, "select id from public.members where student_no = $1", [studentNo]));
  var memberId = mrows.length ? mrows[0].id : null;

  // users 表：role / member_id 的写入只能走 service_role（列级 grant 未向 authenticated 开放）
  var existing = rowsOf(await pgQuery(c, "select uid from public.users where uid = $1", [uid]));
  if (existing.length) {
    await pgQuery(
      c,
      "update public.users set member_id = $2, role = 'member', must_change_password = true, display_name = $3 where uid = $1",
      [uid, memberId, displayName]
    );
  } else {
    await pgQuery(
      c,
      "insert into public.users (uid, member_id, role, must_change_password, display_name) values ($1, $2, 'member', true, $3)",
      [uid, memberId, displayName]
    );
  }
  return { ok: true, data: { uid: uid, memberId: memberId } };
}

async function actionResetPassword(c, ev) {
  var uid = String(ev.uid == null ? "" : ev.uid).trim();
  var password = String(ev.password == null ? "" : ev.password);
  if (!uid || !password) return fail("BAD_INPUT", "缺少 uid / password");
  var client = tcbClient(c);
  // ⚠️ 未验证：ModifyUser 的参数名（Uid / Password）未在真机验证，仅按管控面文档与 CreateUser 对称推断。
  await client.ModifyUser({ EnvId: c.envId, Uid: uid, Password: password });
  return { ok: true, data: { uid: uid } };
}

exports.main = async function (event) {
  var ev = event || {};
  var action = String(ev.action || "");
  var c = envConf();

  try {
    if (!action) return fail("BAD_INPUT", "缺少 action");

    // 凭证检查先于鉴权：环境变量不齐时无法查库鉴权，也不执行任何管控面调用
    var missing = missingEnv(c);
    if (missing.length) return fail("NO_CREDENTIAL", "缺少环境变量：" + missing.join(", "));

    // 鉴权：调用者必须是 admin / superAdmin
    var uid = null;
    try { uid = await callerUid(c); } catch (e) { return fail("UNAUTHENTICATED", "获取登录用户失败：" + errMsg(e)); }
    if (!uid) return fail("UNAUTHENTICATED", "未获取到登录用户，请重新登录");
    var okAdmin;
    try { okAdmin = await isAdminUser(c, uid); } catch (e) { return fail("DB", "鉴权查询失败：" + errMsg(e)); }
    if (!okAdmin) return fail("FORBIDDEN", "仅管理员可管理账号");

    if (action === "probe") return actionProbe(c);
    if (action === "list") return await actionList(c);
    if (action === "create") return await actionCreate(c, ev);
    if (action === "resetPassword") return await actionResetPassword(c, ev);
    return fail("BAD_ACTION", "未知 action：" + action);
  } catch (e) {
    // 上游/内部错误原样透传可读信息；堆栈不外泄
    return fail((e && (e.code || e.Code)) || "UPSTREAM", errMsg(e));
  }
};

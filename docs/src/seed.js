// 演示数据种子：确定性生成（固定种子伪随机，两次 build 的 JSON 完全一致）
// 契约：CONTRACT.md 第 9 节。CA.seed.build() 返回完整 DB 对象。
window.CA = window.CA || {};

CA.seed = (function () {
  var VERSION = 1;
  var CLASS_NAME = "高二(3)班";
  var RNG_SEED = 20260601; // 固定种子，保证可复现

  // ---------- mulberry32：固定种子伪随机 ----------
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ---------- 身份（可切换） ----------
  function buildUsers() {
    return [
      { id: "u_teacher", name: "王老师", role: "superAdmin", title: "班主任" },
      { id: "u_studyleader", name: "李思远", role: "admin", title: "学习委员", studentNo: "20230301" },
      { id: "u_zhang", name: "张天宇", role: "student", title: "学生", studentNo: "20230302" },
      { id: "u_chen", name: "陈嘉怡", role: "student", title: "学生", studentNo: "20230303" },
      { id: "u_liu", name: "刘一鸣", role: "student", title: "学生", studentNo: "20230304" }
    ];
  }

  // ---------- 班级名单（30 人，学号 20230301~20230330） ----------
  // 仅学生（教师身份「王老师」不入名单，避免出现在成绩表/名单里）
  var NAME_POOL = [
    "李思远", "张天宇", "陈嘉怡", "刘一鸣", "林晓萌",
    "赵敏", "孙悦", "周涛", "吴静", "郑凯",
    "冯雪", "褚康", "卫兰", "蒋涛", "沈梦",
    "韩磊", "杨帆", "朱琳", "秦峰", "许晴",
    "何伟", "吕娜", "施展", "张伟", "孔明",
    "曹阳", "严冬", "华晨", "金鑫", "魏然"
  ];

  function buildMembers() {
    var out = [];
    for (var i = 0; i < NAME_POOL.length; i++) {
      var no = String(20230301 + i);
      out.push({ id: "m_" + no, name: NAME_POOL[i], studentNo: no });
    }
    return out;
  }

  // ---------- 科目 ----------
  function buildSubjects() {
    return [
      { id: "s_chinese", name: "语文", fullScore: 150, order: 1 },
      { id: "s_math", name: "数学", fullScore: 150, order: 2 },
      { id: "s_english", name: "英语", fullScore: 150, order: 3 },
      { id: "s_physics", name: "物理", fullScore: 100, order: 4 },
      { id: "s_chemistry", name: "化学", fullScore: 100, order: 5 }
    ];
  }

  // ---------- 考试（3 次） ----------
  function buildExams() {
    return [
      { id: "e_month1", name: "第一次月考", date: "2026-03-15", createdAt: "2026-03-01T08:00:00.000Z" },
      { id: "e_mid", name: "期中考试", date: "2026-04-25", createdAt: "2026-04-10T08:00:00.000Z" },
      { id: "e_month2", name: "第二次月考", date: "2026-05-20", createdAt: "2026-05-06T08:00:00.000Z" }
    ];
  }

  // ---------- 成绩（3 考试 × 5 科 × 30 人 = 450 条） ----------
  // 特征：稳定能力基线 + 科目偏好波动 + 考试难度系数；刘一鸣明显进步；张天宇稳定高分；数学整体偏难。
  function buildScores(members, subjects, exams) {
    var rng = mulberry32(RNG_SEED);
    // 关键学生能力基线（覆盖随机值，保持确定性）
    var SPECIAL = { "张天宇": 0.93, "陈嘉怡": 0.78, "刘一鸣": 0.56 };
    var subjectBase = { s_chinese: 0.00, s_math: -0.10, s_english: 0.02, s_physics: -0.05, s_chemistry: -0.03 };
    var examDiff = [0.00, -0.04, -0.02]; // 每次考试难度系数
    var ability = {};
    var affinity = {};

    // 先为每人抽稳定基线与各科偏好（固定顺序，保证可复现）
    members.forEach(function (m) {
      var a = 0.55 + rng() * 0.40;
      if (SPECIAL[m.name] != null) a = SPECIAL[m.name];
      ability[m.id] = a;
      affinity[m.id] = {};
      subjects.forEach(function (s) {
        affinity[m.id][s.id] = (rng() - 0.5) * 0.12; // ±0.06
      });
    });

    var out = [];
    exams.forEach(function (exam, k) {
      members.forEach(function (m) {
        subjects.forEach(function (s) {
          var jitter = (rng() - 0.5) * 0.08; // ±0.04
          var p = ability[m.id] + affinity[m.id][s.id] + (subjectBase[s.id] || 0) + examDiff[k] + jitter;
          if (m.name === "刘一鸣") p += k * 0.07; // 逐次明显进步
          var score = Math.round(p * s.fullScore);
          var lo = Math.round(0.4 * s.fullScore);
          if (score < lo) score = lo;
          if (score > s.fullScore) score = s.fullScore;
          out.push({
            id: "sc_" + exam.id + "_" + s.id + "_" + m.id,
            examId: exam.id,
            subjectId: s.id,
            memberId: m.id,
            score: score
          });
        });
      });
    });
    return out;
  }

  // ---------- 通知（8 条，覆盖 5 分类；2 pinned、1 important、2 附件、1 链接） ----------
  function buildNotices() {
    return [
      {
        id: "n_exam_final",
        title: "期末考试时间安排",
        category: "考试安排",
        content: "本学期期末考试定于 6 月 25 日至 6 月 27 日进行，共考语文、数学、英语、物理、化学五科。请同学们提前复习，考试当天携带学生证，开考 15 分钟后不得入场。具体考场与座号见附件。",
        timeLabel: "考试时间",
        deadline: "2026-06-25T08:00:00",
        endTime: "2026-06-27T17:00:00",
        location: "教学楼A栋1-3考场",
        course: "语文/数学/英语/物理/化学",
        attachments: [{ name: "期末考试安排表.pdf", size: 245760, type: "application/pdf" }],
        links: [],
        pinned: true,
        important: true,
        publisherId: "u_teacher",
        createdAt: "2026-06-01T08:00:00.000Z",
        updatedAt: "2026-06-01T08:00:00.000Z"
      },
      {
        id: "n_exam_makeup",
        title: "数学补考通知",
        category: "考试安排",
        content: "因上次月考数学成绩异常，现组织部分同学补考。请名单内同学于 6 月 20 日 14:00 到阶梯教室 201 参加补考，迟到 20 分钟以上视为缺考。",
        timeLabel: "考试时间",
        deadline: "2026-06-20T14:00:00",
        endTime: "2026-06-20T16:00:00",
        location: "阶梯教室201",
        course: "数学",
        attachments: [],
        links: [],
        pinned: false,
        important: false,
        publisherId: "u_teacher",
        createdAt: "2026-06-03T09:30:00.000Z",
        updatedAt: "2026-06-03T09:30:00.000Z"
      },
      {
        id: "n_hw_physics",
        title: "物理实验报告作业",
        category: "作业信息",
        content: "物理实验报告（第三章：牛顿第二定律验证）请于 6 月 18 日 22:00 前提交至学习委员处，报告须包含实验数据表、误差分析和结论，逾期不补。",
        timeLabel: "截止时间",
        deadline: "2026-06-18T22:00:00",
        endTime: "",
        location: "",
        course: "物理",
        attachments: [],
        links: [],
        pinned: false,
        important: false,
        publisherId: "u_studyleader",
        createdAt: "2026-06-04T10:15:00.000Z",
        updatedAt: "2026-06-04T10:15:00.000Z"
      },
      {
        id: "n_hw_chinese",
        title: "语文作文提交提醒",
        category: "作业信息",
        content: "本周语文作文题目为《我眼中的夏天》，字数不少于 800 字。请于 6 月 19 日 18:00 前提交电子稿，评分标准见附件。",
        timeLabel: "截止时间",
        deadline: "2026-06-19T18:00:00",
        endTime: "",
        location: "",
        course: "语文",
        attachments: [{ name: "作文评分标准.docx", size: 58368, type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }],
        links: [],
        pinned: false,
        important: false,
        publisherId: "u_teacher",
        createdAt: "2026-06-05T08:40:00.000Z",
        updatedAt: "2026-06-05T08:40:00.000Z"
      },
      {
        id: "n_activity_sports",
        title: "校运动会报名开始",
        category: "活动信息",
        content: "校运动会将于 6 月 28 日举行，现开始报名。项目包括 100 米、400 米、跳远、铅球及 4×100 米接力。请于 6 月 12 日 17:00 前向体育委员报名。",
        timeLabel: "报名截止",
        deadline: "2026-06-12T17:00:00",
        endTime: "2026-06-28T08:00:00",
        location: "学校操场",
        course: "",
        attachments: [],
        links: [],
        pinned: false,
        important: false,
        publisherId: "u_studyleader",
        createdAt: "2026-06-02T14:20:00.000Z",
        updatedAt: "2026-06-02T14:20:00.000Z"
      },
      {
        id: "n_class_parents",
        title: "期末家长会通知",
        category: "班级通知",
        content: "期末家长会定于 6 月 24 日 19:00 在本班教室召开，届时将通报本学期学习情况并说明暑假安排，请家长准时参加。",
        timeLabel: "活动时间",
        deadline: "2026-06-24T19:00:00",
        endTime: "2026-06-24T20:30:00",
        location: "本班教室",
        course: "",
        attachments: [],
        links: [],
        pinned: true,
        important: false,
        publisherId: "u_teacher",
        createdAt: "2026-06-06T16:00:00.000Z",
        updatedAt: "2026-06-06T16:00:00.000Z"
      },
      {
        id: "n_activity_outing",
        title: "班级研学活动报名",
        category: "活动信息",
        content: "班级研学活动计划于 7 月 5 日前往省科技馆，费用 60 元/人。请在 6 月 15 日 12:00 前通过下方链接填写报名表，名额有限。",
        timeLabel: "报名截止",
        deadline: "2026-06-15T12:00:00",
        endTime: "2026-07-05T08:00:00",
        location: "省科技馆",
        course: "",
        attachments: [],
        links: [{ title: "研学活动报名表", url: "https://example.com/signup" }],
        pinned: false,
        important: false,
        publisherId: "u_studyleader",
        createdAt: "2026-06-05T19:00:00.000Z",
        updatedAt: "2026-06-05T19:00:00.000Z"
      },
      {
        id: "n_other_lostfound",
        title: "失物招领",
        category: "其他",
        content: "有同学在教室讲台拾到黑色水杯一个、眼镜盒一个，请失主到讲台认领或联系班级管理员。",
        timeLabel: "相关时间",
        deadline: "",
        endTime: "",
        location: "教室讲台",
        course: "",
        attachments: [],
        links: [],
        pinned: false,
        important: false,
        publisherId: "u_teacher",
        createdAt: "2026-06-08T11:30:00.000Z",
        updatedAt: "2026-06-08T11:30:00.000Z"
      }
    ];
  }

  // ---------- 收藏（张天宇收藏 2 条） ----------
  function buildFavorites() {
    return [
      { userId: "u_zhang", noticeId: "n_exam_final", createdAt: "2026-06-02T10:20:00.000Z" },
      { userId: "u_zhang", noticeId: "n_activity_outing", createdAt: "2026-06-05T19:05:00.000Z" }
    ];
  }

  // ---------- 信息收集（M3 演示数据） ----------
  function buildSurveys() {
    return [
      {
        id: "sv_sports",
        title: "秋季运动会报名",
        desc: "请选择你参加的项目，报名截止后由班委统一提交。",
        status: "open",
        anonymous: false,
        deadline: "2026-06-20T18:00:00",
        createdBy: "u_studyleader",
        createdAt: "2026-06-10T09:00:00.000Z",
        updatedAt: "2026-06-10T09:00:00.000Z",
        questions: [
          { qid: "q1", type: "single", title: "报名项目", required: true, options: ["100 米", "跳远", "4×100 米接力", "不参加"] },
          { qid: "q2", type: "text", title: "想对班委说的话（选填）", required: false, options: [] }
        ]
      },
      {
        id: "sv_meeting",
        title: "本月班会时间投票",
        desc: "选出大家最方便的时间段，多数票胜出。",
        status: "open",
        anonymous: true,
        deadline: "2026-06-18T12:00:00",
        createdBy: "u_teacher",
        createdAt: "2026-06-12T14:00:00.000Z",
        updatedAt: "2026-06-12T14:00:00.000Z",
        questions: [
          { qid: "q1", type: "single", title: "你希望班会安排在", required: true, options: ["周五下午第三节", "周一早读", "周三午休"] }
        ]
      }
    ];
  }

  function shuffle(arr, rnd) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = Math.floor(rnd() * (i + 1));
      var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }

  function buildResponses(members) {
    var rnd = mulberry32(20260602); // 独立种子，不影响成绩数据
    var out = [];
    var sports = ["100 米", "跳远", "4×100 米接力", "不参加"];
    var meeting = ["周五下午第三节", "周一早读", "周三午休"];
    var comments = [
      "希望多安排团体项目", "时间别太晚，放学要赶班车", "可以帮忙计时",
      "建议提前一周通知", "支持周五下午", "希望有摄影记录"
    ];
    var order = shuffle(members.map(function (m) { return m.id; }), rnd);

    // 运动会报名：24 / 30 人
    for (var i = 0; i < 24; i++) {
      var answers = [{ qid: "q1", value: sports[Math.floor(rnd() * sports.length)] }];
      if (rnd() < 0.35) answers.push({ qid: "q2", value: comments[Math.floor(rnd() * comments.length)] });
      out.push({
        id: "rs_sports_" + (i + 1),
        surveyId: "sv_sports",
        memberId: order[i],
        answers: answers,
        createdAt: "2026-06-1" + (1 + Math.floor(rnd() * 8)) + "T10:00:00.000Z"
      });
    }
    // 班会投票：18 / 30 人
    for (var j = 0; j < 18; j++) {
      out.push({
        id: "rs_meeting_" + (j + 1),
        surveyId: "sv_meeting",
        memberId: order[j],
        answers: [{ qid: "q1", value: meeting[Math.floor(rnd() * meeting.length)] }],
        createdAt: "2026-06-13T09:00:00.000Z"
      });
    }
    return out;
  }

  // ---------- 时间整体平移（避免演示数据全部过期） ----------
  // NOW_MS 在模块加载时固定一次：同一进程内多次 build 结果一致（测试要求「两次生成相同」）
  var NOW_MS = Date.now();
  var SEED_EPOCH = Date.UTC(2026, 5, 1); // seed 数据基准日：2026-06-01
  function z2(n) { return n < 10 ? "0" + n : "" + n; }
  function localIso(d) {
    return d.getFullYear() + "-" + z2(d.getMonth() + 1) + "-" + z2(d.getDate()) + "T" +
      z2(d.getHours()) + ":" + z2(d.getMinutes()) + ":" + z2(d.getSeconds());
  }
  // 把 seed 里写死的时间字段整体平移到「今天」附近，保留相对关系（deadline 落到未来）
  // 平移量按整天对齐：只挪日期、保留原始时分（演示时间更整齐，如 18:00 而非 22:34）
  function shiftTimes(db) {
    var delta = Math.round((NOW_MS - SEED_EPOCH) / 86400000) * 86400000;
    var ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
    function shiftOne(v) {
      if (typeof v !== "string" || !ISO_RE.test(v)) return v;
      var t = Date.parse(v);
      if (isNaN(t)) return v;
      var d = new Date(t + delta);
      return v.charAt(v.length - 1) === "Z" ? d.toISOString() : localIso(d);
    }
    function shiftObj(o, fields) {
      if (!o) return;
      fields.forEach(function (k) { if (o[k]) o[k] = shiftOne(o[k]); });
    }
    var noticeFields = ["deadline", "endTime", "createdAt", "updatedAt"];
    db.notices.forEach(function (n) { shiftObj(n, noticeFields); });
    db.favorites.forEach(function (f) { shiftObj(f, ["createdAt"]); });
    db.surveys.forEach(function (s) { shiftObj(s, ["deadline", "createdAt", "updatedAt"]); });
    db.responses.forEach(function (r) { shiftObj(r, ["createdAt"]); });
    return db;
  }

  // ---------- 组装完整 DB ----------
  function build() {
    var users = buildUsers();
    var members = buildMembers();
    var subjects = buildSubjects();
    var exams = buildExams();
    var scores = buildScores(members, subjects, exams);
    var notices = buildNotices();
    var favorites = buildFavorites();
    var surveys = buildSurveys();
    var responses = buildResponses(members);
    var model = (window.CA_CONFIG && window.CA_CONFIG.llm && window.CA_CONFIG.llm.model) || "deepseek-v4-flash";

    var db = {
      version: VERSION,
      users: users,
      members: members,
      notices: notices,
      favorites: favorites,
      subjects: subjects,
      exams: exams,
      scores: scores,
      surveys: surveys,
      responses: responses,
      settings: {
        currentUserId: "u_teacher",
        aiEnabled: true,
        aiModel: model
      }
    };
    return shiftTimes(db);
  }

  return { build: build, CLASS_NAME: CLASS_NAME, VERSION: VERSION };
})();

// 首次加载时若 ca_db 仍为空（store.js 加载早于 seed.js），在此补触发播种
try {
  if (window.CA && CA.store && typeof CA.store.init === "function") CA.store.init();
} catch (e) { /* 静默 */ }

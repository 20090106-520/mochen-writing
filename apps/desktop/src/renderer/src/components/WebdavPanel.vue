<!-- WebDAV 远程备份面板（设置中心「远程备份」分类）。
     与本地整书备份（book-backup.ts）同一条铁律的延伸：这一刀做「把本地整书备份的字节
     PUT 一份到用户自己配的 WebDAV 服务器」，以及反过来「把远程某一份拉回书旁边」。
     配置与密钥分别落盘（密钥走 credential-store，与模型密钥同套加密分份），渲染层只递
     草稿 / 档位 / 远程目录名——服务器地址与盘上落点都由主进程按当前书的 meta.id 拼。
     卡片外壳是 settings-page.css 的 settings-card。 -->
<script setup lang="ts">
import { onMounted, ref } from "vue";
import type {
  WebdavConfigSnapshot,
  WebdavListResult,
  WebdavPullResult,
  WebdavPushResult,
  WebdavVerifyResult
} from "@mochen/contracts";

/** 配置快照；null = 还没读回（首次加载）。 */
const snapshot = ref<WebdavConfigSnapshot | null>(null);
/** url / username 草稿：从快照镜像出来供 input 双绑。 */
const urlDraft = ref("");
const usernameDraft = ref("");
/**
 * 密码草稿：永远从空串起步——已存的密钥不读回渲染层（与模型密钥同口径）。
 * 空串 ⇒ 保留（用户没动）；非空 ⇒ 替换；显式按「清除密码」走的是 `password: ""`。
 */
const passwordDraft = ref("");
/** 最近一次 verify / push / list 的回执；null = 没有新的。 */
const verifyResult = ref<WebdavVerifyResult | null>(null);
const pushResult = ref<WebdavPushResult | null>(null);
const listResult = ref<WebdavListResult | null>(null);
/** 最近一次「拉回本地」的回执；null = 没有新的。 */
const pullResult = ref<WebdavPullResult | null>(null);
/** save 的回执（一句人话）；null = 没有新的。 */
const saveReceipt = ref<string | null>(null);
const busy = ref(false);

async function loadConfig(): Promise<void> {
  snapshot.value = await window.mochen.webdavConfigGet();
  urlDraft.value = snapshot.value.url;
  usernameDraft.value = snapshot.value.username;
  passwordDraft.value = "";
}

async function save(): Promise<void> {
  busy.value = true;
  saveReceipt.value = null;
  try {
    // 空串 ⇒ 保留（与 provider-save 的 apiKey null 同口径，但本契约用 `password?: string`，
    // undefined 才是「保留」——所以空串草稿不进 input.password 字段）。
    const input =
      passwordDraft.value === ""
        ? { url: urlDraft.value, username: usernameDraft.value }
        : {
            url: urlDraft.value,
            username: usernameDraft.value,
            password: passwordDraft.value
          };
    snapshot.value = await window.mochen.webdavConfigSave(input);
    passwordDraft.value = "";
    saveReceipt.value = "已保存。";
  } finally {
    busy.value = false;
  }
}

async function clearPassword(): Promise<void> {
  busy.value = true;
  saveReceipt.value = null;
  try {
    snapshot.value = await window.mochen.webdavConfigSave({
      url: urlDraft.value,
      username: usernameDraft.value,
      password: ""
    });
    passwordDraft.value = "";
    saveReceipt.value = "已清除密码。";
  } finally {
    busy.value = false;
  }
}

async function verify(): Promise<void> {
  busy.value = true;
  verifyResult.value = null;
  try {
    verifyResult.value = await window.mochen.webdavVerify();
  } finally {
    busy.value = false;
  }
}

async function push(): Promise<void> {
  busy.value = true;
  pushResult.value = null;
  try {
    pushResult.value = await window.mochen.webdavPush();
  } finally {
    busy.value = false;
  }
}

async function list(): Promise<void> {
  busy.value = true;
  listResult.value = null;
  try {
    listResult.value = await window.mochen.webdavList();
  } finally {
    busy.value = false;
  }
}

/**
 * 把远程某一份拉回本地（递的只是 list 给的那串目录名——服务器地址与盘上落点都由主进程定）。
 * 拉到的是书的**旁边**一份新目录，绝不盖写任何已有内容，所以这里没有「确认覆盖」这一步。
 */
async function pull(name: string): Promise<void> {
  busy.value = true;
  pullResult.value = null;
  try {
    pullResult.value = await window.mochen.webdavPull(name);
  } finally {
    busy.value = false;
  }
}

onMounted(loadConfig);
</script>

<template>
  <section class="settings-group webdav-panel">
    <div class="settings-card webdav-config-card">
      <h3 class="settings-group-title">远程仓库</h3>
      <p class="settings-group-note">
        配上你自己的 NAS 或支持 WebDAV 的网盘（如坚果云、Nextcloud）。地址必须是 https，
        本机端点（localhost / 127.0.0.1）例外——明文 http 会把密码与全书原样裸送给链路上的设备。
      </p>
      <div class="settings-item webdav-field">
        <label class="settings-item-text" for="webdav-url">
          <strong>地址</strong>
        </label>
        <input
          id="webdav-url"
          v-model="urlDraft"
          class="webdav-input"
          type="text"
          placeholder="https://nas.local/dav/"
          autocomplete="url"
          spellcheck="false"
        />
      </div>
      <div class="settings-item webdav-field">
        <label class="settings-item-text" for="webdav-username">
          <strong>用户名</strong>
        </label>
        <input
          id="webdav-username"
          v-model="usernameDraft"
          class="webdav-input"
          type="text"
          autocomplete="username"
          spellcheck="false"
        />
      </div>
      <div class="settings-item webdav-field">
        <label class="settings-item-text" for="webdav-password">
          <strong>密码</strong>
          <small v-if="snapshot?.hasPassword" class="webdav-password-hint">
            已保存（不填视为保留）
          </small>
        </label>
        <input
          id="webdav-password"
          v-model="passwordDraft"
          class="webdav-input"
          type="password"
          autocomplete="new-password"
          :placeholder="snapshot?.hasPassword ? '不填保留已存密码' : '请输入密码'"
        />
      </div>
      <div class="settings-item webdav-actions">
        <button class="dialog-primary-button" type="button" :disabled="busy" @click="save">
          {{ busy ? "处理中…" : "保存配置" }}
        </button>
        <button
          v-if="snapshot?.hasPassword"
          class="dialog-secondary-button"
          type="button"
          :disabled="busy"
          @click="clearPassword"
        >
          清除密码
        </button>
      </div>
      <p v-if="saveReceipt !== null" class="webdav-receipt">{{ saveReceipt }}</p>
    </div>

    <div class="settings-card webdav-ops-card">
      <h3 class="settings-group-title">远程备份（推 / 拉）</h3>
      <p class="settings-group-note">
        推送会先做一份新本地整书备份，再把那份字节 PUT 到远程
        <code>&lt;url&gt;/&lt;书的 meta.id&gt;/&lt;备份时间戳&gt;/</code>——书没开就推不上去。
        下面清单里每一条都能「拉回本地」：落到当前这本书**旁边**一份新目录，不覆盖任何现有内容。
      </p>
      <div class="settings-item webdav-ops">
        <button class="dialog-secondary-button" type="button" :disabled="busy" @click="verify">
          {{ busy ? "处理中…" : "验证连通" }}
        </button>
        <button class="dialog-primary-button" type="button" :disabled="busy" @click="push">
          {{ busy ? "处理中…" : "推送备份" }}
        </button>
        <button class="dialog-secondary-button" type="button" :disabled="busy" @click="list">
          {{ busy ? "处理中…" : "列出远程备份" }}
        </button>
      </div>

      <div v-if="verifyResult !== null" class="settings-item webdav-result">
        <div class="settings-item-text">
          <strong>验证</strong>
          <p v-if="verifyResult.ok" class="webdav-result-line">
            已连上 {{ verifyResult.server }}。
          </p>
          <p v-else class="webdav-result-line webdav-result-fail">{{ verifyResult.message }}</p>
        </div>
      </div>

      <div v-if="pushResult !== null" class="settings-item webdav-result">
        <div class="settings-item-text">
          <strong>推送</strong>
          <p v-if="pushResult.ok" class="webdav-result-line">
            已推 {{ pushResult.pushedFiles }} / {{ pushResult.fileCount }} 个文件到
            {{ pushResult.name }}。
          </p>
          <p v-else class="webdav-result-line webdav-result-fail">{{ pushResult.message }}</p>
        </div>
      </div>

      <div v-if="listResult !== null" class="settings-item webdav-result">
        <div class="settings-item-text">
          <strong>远程备份清单</strong>
          <p v-if="!listResult.ok" class="webdav-result-line webdav-result-fail">
            {{ listResult.message }}
          </p>
          <ul v-else-if="listResult.entries.length > 0" class="webdav-entries">
            <li v-for="entry in listResult.entries" :key="entry.name" class="webdav-entry">
              <span class="webdav-entry-name">{{ entry.name }}</span>
              <span class="webdav-entry-time">{{ entry.createdAt }}</span>
              <button
                class="dialog-secondary-button webdav-entry-pull"
                type="button"
                :disabled="busy"
                @click="pull(entry.name)"
              >
                拉回本地
              </button>
            </li>
          </ul>
          <p v-else class="webdav-result-line">远程还没有备份。</p>
        </div>
      </div>

      <div v-if="pullResult !== null" class="settings-item webdav-result">
        <div class="settings-item-text">
          <strong>拉回</strong>
          <p v-if="pullResult.ok" class="webdav-result-line">
            已拉回 {{ pullResult.fileCount }} 个文件，落在书旁边的「{{ pullResult.destName }}」。
          </p>
          <p v-else class="webdav-result-line webdav-result-fail">{{ pullResult.message }}</p>
        </div>
      </div>
    </div>
  </section>
</template>

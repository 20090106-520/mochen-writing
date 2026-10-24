/**
 * 添加/编辑模型对话框的接线契约（2026-10-06 批次 5-⑤ 供应商可切之后）。
 * 本仓 verify 用裸 tsc（没有 vue-tsc），`.vue` 零类型检查 ⇒ 接线只能钉成读源码断言
 * （同律先例：provider-settings-wiring.test.ts、model-select-wiring.test.ts）。
 * 注释会被 vue-source-reader 剥掉：只在注释里宣称的接线不算数。
 * prettier 会把长标签/长调用折成每属性一行 ⇒ 钉子一律先压空白（flat）再比，
 * 折行风格变化不吃断言；计数断言（@change ×2、saving 复位 ×4）不受压平影响。
 *
 * **本轮删掉的钉子（不是放宽，是它断言的东西已经不存在了）**：
 * 「供应商与 API 类型是两个写死禁用的下拉，选项写死 OpenAI Compatible / Chat Completions API」。
 * 供应商那一列现在是能切的真下拉；API 类型那一行改成了只读说明——底层只实现了
 * Chat Completions，摆个能点没用的下拉就是装样子。原断言被它的**反面**取代：
 * 界面不许再出现 disabled 的供应商下拉，也不许再出现那两个写死的选项文案。
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { scriptSource, tagAttributes, templateSource, vueSource } from "../utils/vue-source-reader";

const DIALOG = "components/ModelProfileDialog.vue";

/** prettier 折行免疫：所有钉子先走这里。 */
const flat = (text: string): string => text.replace(/\s+/g, " ");
const scriptOf = (): string => flat(scriptSource(DIALOG));
const markupOf = (): string => flat(templateSource(DIALOG));

describe("ModelProfileDialog · 出网与数据通路", () => {
  it("数据全走 useProviderStore：不自己剥错误壳", () => {
    const script = scriptOf();
    expect(script).toContain('from "../stores/useProviderStore"');
    expect(script).not.toContain("presentableProviderError");
    expect(script).not.toContain("Error invoking remote method");
  });

  // 唯一一处允许直连 preload 的是「打开那家网站的密钥页」——它是个 shell 动作
  // （把浏览器叫起来），不是模型配置数据，走 store 反而绕。
  // 本仓另有 5 个组件同样直连 window.mochen，所以这不是破例，是这条边界的准确范围。
  //
  // 2026-10-06：批次 5-⑧ 的「地址自动认服务商」也用到了同一条通道（认出官方那家后给一颗
  // 「去取密钥」），于是 `openProviderKeyPage` 出现了两处。原断言数的是**出现次数**，
  // 现在数的是**用到的方法名**——同一个方法调两处是正常的，冒出新方法才是破例。
  it("直连 window.mochen 只许用到「获取 API 密钥」这一个方法，且不许读配置数据", () => {
    const script = scriptOf();
    const hits = script.match(/window\.mochen\.[A-Za-z]+/g) ?? [];
    expect([...new Set(hits)]).toEqual(["window.mochen.openProviderKeyPage"]);
    // 两处都在，且两处都只是 shell 动作
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("地址或密钥一变就重拉名单：两个输入格的 change 都挂着 fetchNow", () => {
    const markup = markupOf();
    expect(markup.match(/@change="fetchNow"/g)?.length).toBe(2);
  });

  // 失焦才拉不够：粘上密钥 → 看名单这条最自然的路径不成立（得再点一下别处）。
  // 真机上撞到过：填完密钥名单纹丝不动，还挂着上一次（空密钥）拉出来的过期报错。
  it("边打边拉：密钥一有值就防抖拉名单，且关掉对话框不再补一次", () => {
    const script = scriptOf();
    expect(script).toContain("const FETCH_DEBOUNCE_MS = 600;");
    expect(script).toContain("function scheduleFetch()");
    expect(script).toContain("watch([baseURL, apiKey], () => {");
    // 防抖窗口里对话框被关掉 ⇒ 撤掉那次请求，别白花一次配额。
    expect(script).toContain("onUnmounted(() => {");
    expect(script).toContain("if (fetchTimer !== null) clearTimeout(fetchTimer);");
  });

  // 这条是上面那条的根据：空密钥就自动拉 = 拿空凭据问人家要名单，
  // 回一句 401 摆在对话框里，用户会以为自己已经填错了什么。
  it("没填密钥时不自动拉（免得一进来就报「密钥无效」）", () => {
    expect(scriptOf()).toContain('if (apiKey.value.trim() !== "") scheduleFetch();');
  });

  // 草稿传递：带草稿就走 loadModels 的 query 通路（守卫在主进程的 resolveModelListTarget）。
  // 草稿里必须带 authHeader——MiMo 那类端点发 Bearer 会永远 401（批次 5-⑤ 带出来的新坑）。
  it("草稿拉取连头形态一起递下，不能一律 Bearer", () => {
    const script = scriptOf();
    expect(script).toContain(
      "void provider.loadModels(true, { baseURL: url, apiKey: key, authHeader: authHeader.value });"
    );
    expect(script).not.toContain("void provider.loadModels(true, { baseURL: url, apiKey: key });");
  });

  // 编辑态：地址没动时按**那条连接**拉，而不是拿草稿去拼一个假的地址+空密钥请求。
  it("编辑态地址没动 ⇒ 按已存连接拉，不拿空密钥草稿去出网", () => {
    const script = scriptOf();
    expect(script).toContain(
      "if (props.connectionId !== undefined && url === editingConnection.value?.baseURL)"
    );
    expect(script).toContain(
      "void provider.loadModels(true, { connectionId: props.connectionId });"
    );
  });

  it("添加态开箱即拉一次；编辑态模型只读", () => {
    expect(scriptOf()).toContain("onMounted(() => { fetchNow(); });");
    const markup = markupOf();
    expect(markup).toContain('<input v-if="mode !== \'add\'" type="text" :value="model" disabled');
  });

  // 2026-10-06 重做：原生 <datalist> 换成「可搜 + 点一下就选中」的选择器。
  // 原生那个浮层各平台长得都不一样、也搜不了；而 hub 一拉十几个模型、
  // 里面还有图像/视频的混在一起，用户得自己认名字挑。
  //
  // 【2026-10-25 再收一刀：只列写作模型】
  // 用户裁定「我这是写小说的，应该只显示写作模型，其他的模型不显示」——
  // 与模型选择器（ModelSelect.vue）**同一份判据**（`writableModels`）。
  // 分组那一整套随之撤掉：只列写作模型的话，名单里只剩一段，分什么组。
  it("选模型是能搜能点的选择器，不再是原生 datalist 浮层", () => {
    const markup = markupOf();
    const script = scriptOf();
    expect(markup).not.toContain("model-profile-options");
    expect(markup).not.toContain("<datalist");
    // 手填这条路必须留着：有些 hub 的 /models 只回一部分模型。
    expect(markup).toContain('class="model-picker-input"');
    expect(markup).toContain('class="model-picker-search"');
    expect(markup).toContain('v-model="modelQuery"');
    // 点一下就选中，不必先聚焦输入框再从下拉里挑。
    expect(markup).toContain('@click="chooseModel(name)"');
    expect(markup).toContain(':data-model-name="name"');
    expect(markup).toContain(":class=\"{ 'is-chosen': name === modelId }\"");
    expect(script).toContain("function chooseModel(name: string)");
    // 判定下沉 utils，组件里不重写一遍「能不能写」/「搜不搜得到」。
    expect(script).toContain('from "../utils/model-picker"');
    expect(script).toContain("writableModels(suggestedModels.value)");
    expect(script).toContain("filterModels(writableList.value, modelQuery.value)");
    // 反向钉：分组那一整套撤掉了，不许悄悄加回来（那是第二份「名单怎么排」的判定）。
    expect(script).not.toContain("groupModels");
    expect(markup).not.toContain("model-picker-group");
  });

  /**
   * 被藏起来的那几个要说出来（2026-10-25）。
   *
   * 「只列写作模型」不能悄悄做：用户看到上游有 12 个、界面上只有 6 个，
   * 少了的那 6 个去哪儿了？一句话说清楚（"另有 N 个模型没有列出来。图像 / 视频模型写不了对话。"），
   * 免得用户以为这家 provider 就这几个模型。
   *
   * 钉的是**数量真的算出来了**（不是一句写死的文案）+ 那句事实引的是共用那一份。
   */
  it("藏起来的那些模型要说出数量，那句事实引共用那一份", () => {
    const script = scriptOf();
    const markup = markupOf();
    expect(script).toContain("nonWritableCount");
    expect(script).toContain("suggestedModels.value.length - writableList.value.length");
    expect(script).toContain("MODEL_WRITABLE_ONLY_NOTE");
    expect(markup).toContain("MODEL_WRITABLE_ONLY_NOTE");
    expect(markup).toContain("另有 {{ nonWritableCount }} 个模型没有列出来");
  });

  it("名单拉到没拉到，说法要分开：不能拿预置常用名冒充上游名单", () => {
    const markup = markupOf();
    expect(markup).toContain('hasRemoteList ? "模型名单" : "常用模型名"');
    expect(markup).toContain('v-if="!hasRemoteList"');
    expect(markup).toContain("没拉到名单（");
    expect(markup).toContain("还没拉到名单。");
  });

  // 这条是上一条的根据：hasRemoteList 判错，上面那句「拉到了」就是在骗人。
  it("hasRemoteList 只认上游真回了名单（ok 为真）", () => {
    expect(scriptOf()).toContain(
      "const hasRemoteList = computed(() => provider.models !== null && provider.models.ok)"
    );
  });

  it("搜索框搜不到时给一句话，不无声无息（空列表看着像坏了）", () => {
    const markup = markupOf();
    expect(markup).toContain('v-if="visibleModels.length === 0"');
    expect(markup).toContain("没一个匹配「{{ modelQuery }}」");
  });

  it("名单太长只铺一部分，其余说清楚还有多少（不让列表把对话框撑爆）", () => {
    const markup = markupOf();
    const script = scriptOf();
    expect(script).toContain("MODEL_PICKER_LIST_LIMIT");
    expect(script).toContain("visibleModels.value.slice(0, MODEL_PICKER_LIST_LIMIT)");
    expect(markup).toContain('v-if="hiddenModelCount > 0"');
    expect(markup).toContain("还有 {{ hiddenModelCount }} 个没列出来");
  });

  // 选完得看得见：列表还开着，看不见自己选了谁就等于没选。
  it("选中的那条会被滚进视野", () => {
    const script = scriptOf();
    expect(script).toContain("async function revealSelected()");
    expect(script).toContain('scrollIntoView({ block: "nearest" })');
    expect(script).toContain("watch(modelId, () => {");
  });

  // 拉取状态不再单列一行：进按钮与选择器，说两遍会被当成两个问题。
  it("拉取状态不再重复摆两处", () => {
    const markup = markupOf();
    expect(markup).not.toContain("正在拉取模型名单…");
    expect(markup).not.toContain('v-else-if="fetchReason"');
    expect(markup).toContain('{{ provider.modelsLoading ? "拉取中…" : "重新拉取" }}');
  });

  it("Model ID 的兜底提示：改名不可改，得说清楚下一步怎么做", () => {
    const markup = markupOf();
    expect(markup).toContain("模型名添加后不可改；要换模型就再添加一条。");
    expect(markup).toContain("模型本身不可改；要换模型请新增一条。");
  });
});

describe("ModelProfileDialog · 供应商可切（批次 5-⑤ 的正题）", () => {
  it("供应商是真能切的下拉，且按国内/国外/自定义分组", () => {
    const markup = markupOf();
    const script = scriptOf();
    expect(markup).toContain('<select v-model="providerId">');
    expect(markup).toContain('<optgroup v-for="group in PROVIDER_DIALOG_GROUPS"');
    expect(markup).toContain(':label="group.label"');
    // 分组表来自 contracts，组件里不自己排一遍（铁律 6：一份实现）。
    expect(script).toContain("PROVIDER_DIALOG_GROUPS");
    expect(script).toContain('from "@mochen/contracts"');
  });

  // 这条是上面那条的根据：不 watch providerId，切换就只是换了下拉里的一个字。
  it("切换供应商自动把地址与头形态带过来（选了 DeepSeek 还得自己搜地址就不叫快捷）", () => {
    const script = scriptOf();
    expect(script).toContain("watch(providerId, (next) =>");
    expect(script).toContain("baseURL.value = picked.baseURL;");
    expect(script).toContain("authHeader.value = picked.authHeader;");
    expect(script).toContain("const picked = presetOf(next);");
  });

  it("自定义那一项不覆盖用户已经填好的地址（他们就是自己填的）", () => {
    expect(scriptOf()).toContain('else if (next === CUSTOM_PROVIDER_ID && baseURL.value === "")');
  });

  it("请求头形态这一格能切，且两条取值都在", () => {
    const markup = markupOf();
    expect(markup).toContain('<select v-model="authHeader">');
    expect(markup).toContain('<option value="bearer">');
    expect(markup).toContain('<option value="api-key">');
  });

  it("「获取 API 密钥」只递 providerId，绝不递任意 URL（否则等于开了条 file:// 的路子）", () => {
    const markup = markupOf();
    const script = scriptOf();
    expect(markup).toContain('@click="openKeyPage"');
    expect(script).toContain("await window.mochen.openProviderKeyPage(providerId.value)");
    expect(script).not.toContain("openProviderKeyPage(baseURL");
    expect(script).not.toContain("openProviderKeyPage(url");
    // 自定义没有对应的密钥页，别给一颗点了没反应还报错的书。
    expect(script).toContain("if (isCustom.value) return;");
    expect(markup).toContain('v-if="!isCustom"');
  });
});

describe("ModelProfileDialog · 本机模型（Ollama，2026-10-05 批次 5-②）", () => {
  it("端点常量与文案都从 contracts 取，组件里不写字面量（铁律 6）", () => {
    const script = scriptOf();
    expect(script).toContain("OLLAMA_BASE_URL");
    expect(script).toContain("OLLAMA_FILL_LABEL");
    expect(script).toContain("LOCAL_MODEL_KEY_NOTE");
    // 反向钉：端点一旦在组件里再写一遍，就有两份会各自漂移的「本机地址」
    expect(script).not.toContain("11434");
  });

  it("一键填入：地址摆好 + 密钥清空 + 立刻拉一次名单验证 Ollama 在不在跑", () => {
    const script = scriptOf();
    expect(script).toContain("function fillOllama()");
    expect(script).toContain("baseURL.value = OLLAMA_BASE_URL;");
    expect(script).toContain('apiKey.value = "";');
    expect(script).toContain("keyTouched.value = true;");
    // 填完不拉一次，用户不知道 Ollama 有没有在跑——那正是这颗按钮存在的意义
    expect(script).toContain("fetchNow();");
  });

  it("按钮真的在模板里，且用的是 contracts 那句文案", () => {
    const markup = markupOf();
    expect(markup).toContain('@click="fillOllama"');
    expect(markup).toContain("{{ OLLAMA_FILL_LABEL }}");
    expect(markup).toContain("{{ LOCAL_MODEL_KEY_NOTE }}");
    expect(markup).not.toContain("11434");
  });

  // 5-② 定的三态语义（null 沿用 / "" 清空 / 新值）。文案必须把最容易搞错的那支说清楚：
  // **没碰过框**就保存 ≠ 清空。曾经那句「留空且保存会清掉」正是会误导人的写法。
  it("密钥栏把「没碰过」与「碰过再清空」分成两句说，不含糊成一句", () => {
    const markup = markupOf();
    expect(markup).toContain("动过这个框再留空保存＝清掉已存密钥");
    expect(markup).toContain("没碰过就保存＝沿用原来那把");
  });
});

describe("ModelProfileDialog · 保存这条线", () => {
  it("空模型名不让点保存（disabled 判定真实出现，不是恒可点）", () => {
    expect(markupOf()).toContain(
      ":disabled=\"saving || (mode === 'add' && modelId.trim() === '')\""
    );
  });

  // 2026-10-05 批次 5-②（Ollama）改过语义：此前只有「空 = null（沿用）」一种，
  // 于是没法在切到本机端点时把云端密钥清掉——留着它，本地那次也会带着云端 key 出网。
  // 现在三种：没碰过密钥框 ⇒ null；碰过且清空 ⇒ ""；填了新值 ⇒ 新值。
  it("密钥靠 keyTouched 区分「沿用」与「明确清空」", () => {
    const script = scriptOf();
    expect(script).toContain("apiKey: keyTouched.value ? apiKey.value.trim() : null");
    expect(script).toContain("const keyTouched = ref(false);");
  });

  // 这条是上一条的根据：keyTouched 必须在用户真的动过密钥框时才为真。
  it("密钥框的 @input 负责置位 keyTouched（没碰过就不该当成「要清空」）", () => {
    expect(markupOf()).toContain('@input="keyTouched = true"');
  });

  it("不传 connectionId = 新建一条连接；编辑态传的是那条连接（传 undefined 不是改原来那条）", () => {
    const script = scriptOf();
    expect(script).toContain("await provider.saveConnection({");
    expect(script).toContain("connectionId: props.connectionId,");
  });

  /**
   * 回归钉：刚存那条连接的 id 必须用**主进程回传的那个**。
   * 曾经是拿地址回头在 view 里 find——同一家开第二个账号时地址一模一样，
   * find 先命中前一条，模型就挂到用户没在配的那条连接上。
   */
  it("挂模型用主进程回传的 connectionId，不许拿地址回头 find", () => {
    const script = scriptOf();
    expect(script).toContain("const savedId = await provider.saveConnection({");
    expect(script).toContain("savedConnectionId.value = savedId;");
    // 反向钉：**按地址**反查就是当年那个 bug。按 id 查（editingConnection）是对的，留着。
    expect(script).not.toContain("c.baseURL === baseURL.value");
  });

  it("添加的下一步 = 连接 + select（加档案并挂在那条连接上）；两步任一失败都留在对话框里", () => {
    const script = scriptOf();
    expect(script).toContain(
      "const added = await provider.select({ model: modelId.value.trim(), connectionId: savedConnectionId.value });"
    );
    // 存不上（回执为 null）/ 挂不上档案 两条失败路各复位一次，末尾成功复位一次 ⇒ 3。
    expect(script.match(/saving\.value = false;/g)?.length).toBe(3);
  });

  it("存完立刻对那条连接体检：软校验也要把「配好了没有」摆出来", () => {
    expect(scriptOf()).toContain("void provider.verifyConnection(savedConnectionId.value);");
  });

  it("密钥显隐是真切换：input 的 type 跟着 showKey 走，眼睛按钮报得出 aria-label", () => {
    const markup = markupOf();
    expect(markup).toContain(`:type="showKey ? 'text' : 'password'"`);
    expect(markup).toContain(`:aria-label="showKey ? '隐藏密钥' : '显示密钥'"`);
  });
});

describe("ModelProfileDialog · 弹层本体与诚实文案", () => {
  it("是弹层就得有关闭通路：遮罩按下关、× 关、取消关（Esc 那一支见下一条）", () => {
    const markup = markupOf();
    expect(markup).toContain(`@mousedown.self="emit('close')"`);
    expect(markup).toContain(`@click="emit('close')"`);
  });

  // 这条决定是 2026-10-07 批次 5-㊱ 改的，改的是**归属**不是**有无**，逐条说明：
  // 原来这里钉的是 `@keydown="onKeydown"` + `if (event.key !== "Escape") return;`，即
  // 「Esc 的裁决住在本组件里」。那条守卫只量形状：keydown 走冒泡，焦点不在这棵子树里就收不到，
  // 而本组件从来没把焦点挪进对话框 —— 真机量到焦点仍在左栏那颗「添加模型」上。
  // 更绕的一次是设置页上按 Esc：弹窗确实消失了，但**不是它自己关的**，是全局 escape-policy 的
  // close-overlay 把整个设置视图卸了；同一个「关掉了」量了两种不同的东西，看起来却是绿的。
  // 于是 Esc 与焦点进出改由 composables/useModalFocus 一处独家提供（铁律 6：同一判定只留一份实现），
  // 本组件不再保留第二处 Escape 判定 —— 下面这三条钉的就是这个新决定。
  it("Esc 的裁决不在本组件里：接 useModalFocus，模板上不再挂 keydown", () => {
    expect(scriptOf()).toContain('from "../composables/useModalFocus"');
    expect(scriptOf()).toContain("useModalFocus({");
    expect(markupOf()).not.toContain("@keydown");
  });

  it("关的动作交给 composable 的仍是本组件那条 close，不另开一条", () => {
    expect(scriptOf()).toContain('close: () => emit("close")');
  });

  it('对话框根节点带 tabindex="-1"：它是「层里没有可聚焦元素时」的落点', () => {
    // 少了它，useModalFocus 兜底那处 el.focus() 会静默失败（div 默认不可聚焦），
    // 症状是「弹层开着、焦点却还在外面」，而模板上一点报错都没有。
    expect(tagAttributes(markupOf(), "workspace-dialog").join(" ")).toContain('tabindex="-1"');
  });

  it("两种模式的标题各自诚实：添加是「添加模型」，编辑改的是共用连接而不是模型", () => {
    const markup = markupOf();
    expect(markup).toContain("添加模型");
    expect(markup).toContain("编辑连接");
    // 「模型名添加后不可改」也得说清楚，否则用户以为编辑能改名。
    expect(markup).toContain("模型本身不可改；要换模型请新增一条。");
  });

  // 本轮删掉的旧钉的反面：旧的断言是「有两个写死禁用的下拉 + 两个写死的选项」。
  // 那正是被用户判定成「装样子」的东西，现在只钉它不许回来。
  it("不许再有写死禁用的供应商下拉，也不许再摆那两个假选项", () => {
    const markup = markupOf();
    expect(markup).not.toContain("<select disabled>");
    expect(markup).not.toContain("OpenAI Compatible");
    expect(markup).not.toContain("Chat Completions API");
  });

  it("API 类型只留一句诚实说明：协议固定是 Chat Completions，别的形态没做就说没做", () => {
    expect(markupOf()).toContain("协议固定是 Chat Completions（OpenAI 兼容），暂不支持别的形态。");
  });

  it("体检结果摆在对话框里而不是保存后消失：三档各有一句文案", () => {
    const markup = markupOf();
    expect(markup).toContain('data-testid="provider-verify"');
    expect(markup).toContain("连得上，名单里有");
    // 连不上时要说清「配置已经存下来了」，否则软校验看着像硬拦截。
    expect(markup).toContain("配置已经存下来了，可以回头再连");
  });

  /**
   * 2026-10-06 语义变化，原断言（`expect(markup).toContain("连不上：")`）已随实现一起撤销。
   *
   * **为什么撤销**：主进程那条 `networkReason` 从此**按失败分类自己说一整句**（证书对不上域名 /
   * 域名解析不出来 / 端口没人听 / 路由不到）。对话框再套一个「连不上：」前缀，会把它说反——
   * 真机实测出现过「连不上：连上了那台机器但没人监听这个端口」，前后自相矛盾。
   * 旧断言钉的不是「有一句给用户看的话」，而是「有某个特定的前缀字面量」，那个字面量本身才是错的。
   *
   * **换成更强的钉**：reason 必须**原样**出网（不许在渲染层加任何修饰），
   * 且前缀不许回来。这比原来那条只查一个子串更严。
   */
  it("连不上一支原样显示主进程的理由，不许在渲染层加任何前缀（2026-10-06）", () => {
    // 用 templateSource 而不是 markupOf/vueSource：前缀那句在两处的**注释里**都被引用过
    // （解释为什么删掉它），拿整份原文做 not.toContain 会被自己的注释反咬。
    const markup = templateSource(DIALOG);
    expect(markup).toContain("{{ verify.reason }}");
    // 分类之后 reason 自己就是完整句子；再套前缀就是把它说反。
    expect(markup).not.toContain("连不上：");
    expect(markup).not.toContain("连不上:");
  });

  it("设置页的连接卡片也原样显示（两处不许各写一份前缀，铁律 6）", () => {
    const panel = templateSource("components/ProviderSettings.vue");
    expect(panel).toContain("{{ provider.verify[group.connection.id].reason }}");
    expect(panel).not.toContain("连不上：");
    expect(panel).not.toContain("连不上:");
  });

  it("弹层全文不出现硬编码颜色：样式一律走 token", () => {
    expect(vueSource(DIALOG)).not.toMatch(/(color|background|border)\s*:\s*#[0-9a-fA-F]/);
  });
});

/**
 * 地址自动认服务商（2026-10-06 批次 5-⑧）的接线。
 *
 * 判据本身在 contracts 的 `detectProviderByBaseURL`（那里 13 条真单测），
 * 这里只钉「接没接上」——`.vue` 不进类型程序，漏一个 import 编译器不报、运行时才炸。
 */
describe("地址自动认服务商（批次 5-⑧）", () => {
  const script = scriptOf();
  const markup = markupOf();

  it("真的 import 了那个纯函数（漏 import 编译器不报，运行时 undefined）", () => {
    expect(script).toContain("detectProviderByBaseURL");
    expect(script).toMatch(
      /import \{[^}]*detectProviderByBaseURL[^}]*\} from "@mochen\/contracts"/
    );
  });

  it("它是个 computed，跟着地址实时变（不是挂载时算一次就定死）", () => {
    expect(script).toContain(
      "const detected = computed(() => detectProviderByBaseURL(baseURL.value))"
    );
  });

  it("认出来时把**密钥头**也说给用户听（只给名字等于白认）", () => {
    expect(markup).toContain("detected.label");
    expect(markup).toContain("detected.authHeader");
  });

  it("认不出来时不许显示任何「认出来了」的痕迹（宁可没提示，不许假提示）", () => {
    // 那条提示行是 v-if="detected.known"；反向钉在这里的是它不许有兜底文案
    expect(markup).toContain('v-if="detected.known"');
    expect(markup).not.toContain('v-else class="provider-field-note provider-detected"');
  });

  it("**不改**用户填的地址，也不替他切供应商下拉（那会让他不知道自己存成了哪一家）", () => {
    // 判据在「显示」这一层：detected 只被模板读，没被写回 baseURL / providerId
    expect(script).not.toMatch(/baseURL\.value\s*=\s*detected/);
    expect(script).not.toMatch(/providerId\.value\s*=\s*detected/);
  });

  it("「去取密钥」走 providerId 通道，不新开一条能递任意 URL 的路", () => {
    expect(script).toContain("window.mochen.openProviderKeyPage(id)");
    // 主进程那条只收 providerId 再自己查预设表（agent-ipc.ts）；递 URL 出去会放行 file:// 与内网地址
    expect(script).not.toMatch(/openExternal\s*\(\s*detected/);
    expect(script).not.toMatch(/openExternal\s*\(\s*url/);
  });

  it("连接卡片也用真名（认出来就不该再叫「自定义」）", () => {
    const main = readFileSync(
      fileURLToPath(new URL("../../../main/provider-settings.ts", import.meta.url)),
      "utf8"
    );
    expect(main).toContain("export function connectionLabelOf(");
    expect(main).toContain("detected.known ? detected.label");
  });
});

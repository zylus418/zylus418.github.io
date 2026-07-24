/**
 * 问卷功能模块
 * 让梦角从字卡库中随机选择答案回复问卷
 */

// ===== 数据管理 =====

/**
 * 获取问卷存储键
 */
function getSurveyStorageKey() {
    return `${APP_PREFIX}${SESSION_ID}_surveys`;
}

/**
 * 加载所有问卷
 */
async function loadSurveys() {
    try {
        const data = await localforage.getItem(getSurveyStorageKey());
        return data || [];
    } catch (e) {
        console.warn('加载问卷数据失败:', e);
        return [];
    }
}

/**
 * 保存问卷列表
 */
async function saveSurveys(surveys) {
    try {
        await localforage.setItem(getSurveyStorageKey(), surveys);
    } catch (e) {
        console.error('保存问卷数据失败:', e);
    }
}

/**
 * 生成唯一ID
 */
function generateSurveyId() {
    return 'survey_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6);
}

// ===== 问卷核心逻辑 =====

/**
 * 创建新问卷
 */
async function createSurvey(title, questions, replyDelayMin, replyDelayMax) {
    const surveys = await loadSurveys();
    const newSurvey = {
        id: generateSurveyId(),
        title: title || '未命名问卷',
        questions: questions.filter(q => q.trim()),
        replyDelayMin: replyDelayMin || DEFAULT_SURVEY_REPLY_DELAY_MIN,
        replyDelayMax: replyDelayMax || DEFAULT_SURVEY_REPLY_DELAY_MAX,
        createdAt: Date.now(),
        status: 'pending', // pending | completed
        replies: [] // { questionIndex, answer, timestamp }
    };
    surveys.unshift(newSurvey);
    await saveSurveys(surveys);
    return newSurvey;
}

/**
 * 删除问卷
 */
async function deleteSurvey(surveyId) {
    const surveys = await loadSurveys();
    const filtered = surveys.filter(s => s.id !== surveyId);
    await saveSurveys(filtered);
}

/**
 * 获取单个问卷
 */
async function getSurvey(surveyId) {
    const surveys = await loadSurveys();
    return surveys.find(s => s.id === surveyId);
}

/**
 * 开始问卷（让梦角开始回答）
 */
async function startSurvey(surveyId) {
    const survey = await getSurvey(surveyId);
    if (!survey) return null;
    if (survey.status === 'completed') return survey;
    
    // 重置回复
    survey.replies = [];
    survey.status = 'pending';
    await saveSurveys(await loadSurveys());
    return survey;
}

/**
 * 让梦角回答问卷 - 模拟对方随机回复
 */
async function simulateSurveyReply(surveyId, onQuestionAnswered) {
    const survey = await getSurvey(surveyId);
    if (!survey) return null;
    if (survey.status === 'completed') return survey;
    if (survey.questions.length === 0) {
        survey.status = 'completed';
        await saveSurveys(await loadSurveys());
        return survey;
    }

    // ============ 关键修复：获取字卡库 ============
    // 1. 从全局变量获取
    let replyPool = [];
    
    // 尝试从 window 获取
    if (typeof window.customReplies !== 'undefined' && Array.isArray(window.customReplies)) {
        replyPool = window.customReplies;
    } else if (typeof customReplies !== 'undefined' && Array.isArray(customReplies)) {
        replyPool = customReplies;
    } else {
        // 如果都没有，尝试从 localStorage 加载
        try {
            const stored = await localforage.getItem(getStorageKey('customReplies'));
            if (stored && Array.isArray(stored)) {
                replyPool = stored;
                // 同步到全局
                if (typeof window.customReplies === 'undefined') {
                    window.customReplies = stored;
                }
            }
        } catch (e) {
            console.warn('从存储加载字卡失败:', e);
        }
    }

    // 过滤被屏蔽的字卡
    const disabledItems = (() => {
        try {
            const raw = localStorage.getItem('disabledReplyItems');
            return raw ? new Set(JSON.parse(raw)) : new Set();
        } catch { return new Set(); }
    })();
    
    const disabledGroupItems = new Set();
    if (typeof window.customReplyGroups !== 'undefined') {
        window.customReplyGroups.forEach(g => {
            if (g.disabled && Array.isArray(g.items)) {
                g.items.forEach(item => disabledGroupItems.add(item));
            }
        });
    }

    // 过滤有效字卡
    const filteredPool = replyPool
        .filter(r => r && typeof r === 'string' && r.trim())
        .filter(r => !disabledItems.has(r) && !disabledGroupItems.has(r))
        .map(r => String(r || '').trim())
        .filter(Boolean);

    console.log('[问卷] 字卡池大小:', filteredPool.length);
    console.log('[问卷] 字卡样本:', filteredPool.slice(0, 5));

    if (filteredPool.length === 0) {
        // 如果字卡为空，尝试从 CONSTANTS 获取默认回复
        if (typeof CONSTANTS !== 'undefined' && CONSTANTS.REPLY_MESSAGES && CONSTANTS.REPLY_MESSAGES.length > 0) {
            filteredPool.push(...CONSTANTS.REPLY_MESSAGES);
        }
        // 如果还是空，添加默认兜底
        if (filteredPool.length === 0) {
            filteredPool.push('嗯嗯', '好的', '知道了', '在想你', '今天怎么样？');
        }
        showNotification('字卡库为空，使用默认回复', 'warning', 3000);
    }

    // 逐题回复
    for (let i = 0; i < survey.questions.length; i++) {
        const delay = survey.replyDelayMin + Math.random() * (survey.replyDelayMax - survey.replyDelayMin);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // 从字卡池中随机选择
        const shuffled = [...filteredPool].sort(() => Math.random() - 0.5);
        const answer = shuffled[Math.floor(Math.random() * shuffled.length)];
        
        survey.replies.push({
            questionIndex: i,
            answer: answer,
            timestamp: Date.now()
        });

        // 回调通知
        if (onQuestionAnswered) {
            onQuestionAnswered(i, answer);
        }

        // 模拟打字指示器
        if (settings.typingIndicatorEnabled) {
            showSurveyTypingIndicator(true);
            await new Promise(resolve => setTimeout(resolve, 800 + Math.random() * 1200));
            showSurveyTypingIndicator(false);
        }
    }

    survey.status = 'completed';
    await saveSurveys(await loadSurveys());
    return survey;
}

// ===== UI 渲染 =====

let currentSurveyView = 'list'; // list | create | detail

/**
 * 渲染问卷管理界面
 */
async function renderSurveyPanel() {
    const container = document.getElementById('survey-content');
    if (!container) return;

    if (currentSurveyView === 'list') {
        await renderSurveyList(container);
    } else if (currentSurveyView === 'create') {
        renderSurveyCreateForm(container);
    } else if (currentSurveyView === 'detail') {
        await renderSurveyDetail(container);
    }
}

/**
 * 渲染问卷列表
 */
async function renderSurveyList(container) {
    const surveys = await loadSurveys();
    
    container.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
            <div style="font-size:13px;color:var(--text-secondary);">
                共 <strong style="color:var(--accent-color);">${surveys.length}</strong> 份问卷
            </div>
            <button class="modal-btn modal-btn-primary" onclick="switchSurveyView('create')" style="padding:8px 16px;font-size:13px;">
                <i class="fas fa-plus"></i> 新建问卷
            </button>
        </div>
        <div id="survey-list" style="display:flex;flex-direction:column;gap:10px;max-height:55vh;overflow-y:auto;padding-right:4px;">
        </div>
    `;

    const listEl = container.querySelector('#survey-list');
    
    if (surveys.length === 0) {
        listEl.innerHTML = `
            <div style="text-align:center;padding:40px 20px;color:var(--text-secondary);">
                <i class="fas fa-clipboard-list" style="font-size:32px;opacity:0.3;display:block;margin-bottom:12px;"></i>
                <p style="font-size:14px;font-weight:500;">还没有问卷</p>
                <p style="font-size:12px;opacity:0.6;">点击"新建问卷"创建第一份吧</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = surveys.map(survey => {
        const createdAt = new Date(survey.createdAt);
        const dateStr = `${createdAt.getFullYear()}/${String(createdAt.getMonth()+1).padStart(2,'0')}/${String(createdAt.getDate()).padStart(2,'0')} ${String(createdAt.getHours()).padStart(2,'0')}:${String(createdAt.getMinutes()).padStart(2,'0')}`;
        const statusText = survey.status === 'completed' ? '已完成' : '待回复';
        const statusColor = survey.status === 'completed' ? '#6BCB77' : 'var(--accent-color)';
        const replyCount = survey.replies ? survey.replies.length : 0;
        const totalQuestions = survey.questions.length;

        return `
            <div class="survey-card" style="
                background:var(--primary-bg);
                border:1px solid var(--border-color);
                border-radius:14px;
                padding:14px 16px;
                cursor:pointer;
                transition:all 0.2s;
                position:relative;
            " onclick="openSurveyDetail('${survey.id}')">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
                    <div style="flex:1;min-width:0;">
                        <div style="font-size:14px;font-weight:600;color:var(--text-primary);margin-bottom:4px;display:flex;align-items:center;gap:8px;">
                            ${survey.title}
                            <span style="font-size:10px;background:${statusColor}22;color:${statusColor};padding:2px 8px;border-radius:10px;font-weight:500;">${statusText}</span>
                        </div>
                        <div style="font-size:12px;color:var(--text-secondary);display:flex;gap:12px;flex-wrap:wrap;">
                            <span><i class="far fa-calendar-alt" style="margin-right:4px;"></i>${dateStr}</span>
                            <span><i class="far fa-file-alt" style="margin-right:4px;"></i>${totalQuestions} 题</span>
                            <span><i class="far fa-comment-dots" style="margin-right:4px;"></i>${replyCount}/${totalQuestions} 已答</span>
                        </div>
                    </div>
                    <div style="display:flex;gap:4px;flex-shrink:0;">
                        <button class="survey-action-btn" onclick="event.stopPropagation();deleteSurveyItem('${survey.id}')" style="
                            background:none;border:none;color:var(--text-secondary);cursor:pointer;padding:4px 6px;border-radius:6px;font-size:13px;transition:all 0.2s;
                        " onmouseover="this.style.color='#ff4757';this.style.background='rgba(255,71,87,0.1)'" onmouseout="this.style.color='';this.style.background=''">
                            <i class="fas fa-trash-alt"></i>
                        </button>
                    </div>
                </div>
                ${survey.status === 'pending' ? `
                    <button class="modal-btn modal-btn-primary" onclick="event.stopPropagation();startSurveyAndReply('${survey.id}')" style="
                        margin-top:10px;padding:6px 14px;font-size:12px;width:auto;
                    ">
                        <i class="fas fa-play"></i> 开始回复
                    </button>
                ` : `
                    <div style="margin-top:8px;font-size:11px;color:var(--text-secondary);opacity:0.7;display:flex;align-items:center;gap:4px;">
                        <i class="fas fa-check-circle" style="color:#6BCB77;"></i>
                        已完成全部回复
                    </div>
                `}
            </div>
        `;
    }).join('');
}

/**
 * 渲染创建问卷表单
 */
function renderSurveyCreateForm(container) {
    container.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;">
            <button class="modal-btn modal-btn-secondary" onclick="switchSurveyView('list')" style="padding:6px 12px;font-size:12px;">
                <i class="fas fa-arrow-left"></i> 返回列表
            </button>
            <span style="font-size:14px;font-weight:600;color:var(--text-primary);">创建新问卷</span>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;">
            <div>
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:5px;font-weight:600;">问卷标题</label>
                <input type="text" id="survey-title-input" class="modal-input" placeholder="输入问卷标题..." style="font-size:14px;">
            </div>
            <div>
                <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:5px;font-weight:600;">问题列表 <span style="font-weight:400;opacity:0.6;">（每行一个问题）</span></label>
                <textarea id="survey-questions-input" class="modal-textarea" rows="6" placeholder="例如：&#10;你最喜欢什么颜色？&#10;今天心情怎么样？&#10;想对我说什么？" style="font-size:13px;line-height:1.8;"></textarea>
                <div style="font-size:11px;color:var(--text-secondary);margin-top:4px;display:flex;justify-content:space-between;">
                    <span>至少 1 个问题</span>
                    <span id="survey-question-count">0 个问题</span>
                </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div>
                    <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:5px;font-weight:600;">最短回复延迟</label>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="range" id="survey-delay-min" min="1000" max="30000" step="1000" value="3000" style="flex:1;accent-color:var(--accent-color);">
                        <span id="survey-delay-min-label" style="font-size:12px;color:var(--text-secondary);min-width:50px;text-align:right;">3s</span>
                    </div>
                </div>
                <div>
                    <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:5px;font-weight:600;">最长回复延迟</label>
                    <div style="display:flex;align-items:center;gap:8px;">
                        <input type="range" id="survey-delay-max" min="1000" max="60000" step="1000" value="15000" style="flex:1;accent-color:var(--accent-color);">
                        <span id="survey-delay-max-label" style="font-size:12px;color:var(--text-secondary);min-width:50px;text-align:right;">15s</span>
                    </div>
                </div>
            </div>
            <div style="display:flex;gap:10px;margin-top:4px;">
                <button class="modal-btn modal-btn-secondary" onclick="switchSurveyView('list')" style="flex:1;">取消</button>
                <button class="modal-btn modal-btn-primary" onclick="submitSurveyCreate()" style="flex:2;">
                    <i class="fas fa-check"></i> 创建问卷
                </button>
            </div>
        </div>
    `;

    // 字数统计
    const questionsInput = document.getElementById('survey-questions-input');
    const countEl = document.getElementById('survey-question-count');
    if (questionsInput && countEl) {
        questionsInput.addEventListener('input', () => {
            const lines = questionsInput.value.split('\n').filter(l => l.trim());
            countEl.textContent = `${lines.length} 个问题`;
        });
    }

    // 延迟滑块联动
    const delayMin = document.getElementById('survey-delay-min');
    const delayMax = document.getElementById('survey-delay-max');
    const minLabel = document.getElementById('survey-delay-min-label');
    const maxLabel = document.getElementById('survey-delay-max-label');

    if (delayMin && minLabel) {
        delayMin.addEventListener('input', () => {
            const val = parseInt(delayMin.value);
            minLabel.textContent = val >= 60000 ? `${val/60}min` : `${val/1000}s`;
            if (delayMax && parseInt(delayMax.value) < val) {
                delayMax.value = val;
                maxLabel.textContent = val >= 60000 ? `${val/60}min` : `${val/1000}s`;
            }
        });
    }
    if (delayMax && maxLabel) {
        delayMax.addEventListener('input', () => {
            const val = parseInt(delayMax.value);
            maxLabel.textContent = val >= 60000 ? `${val/60}min` : `${val/1000}s`;
            if (delayMin && parseInt(delayMin.value) > val) {
                delayMin.value = val;
                minLabel.textContent = val >= 60000 ? `${val/60}min` : `${val/1000}s`;
            }
        });
    }
}

/**
 * 渲染问卷详情（查看回复）
 */
async function renderSurveyDetail(container) {
    const surveyId = container.dataset.surveyId;
    const survey = await getSurvey(surveyId);
    if (!survey) {
        container.innerHTML = `
            <div style="text-align:center;padding:30px;color:var(--text-secondary);">
                <i class="fas fa-exclamation-circle" style="font-size:24px;opacity:0.4;display:block;margin-bottom:8px;"></i>
                问卷不存在或已被删除
                <br><button class="modal-btn modal-btn-secondary" onclick="switchSurveyView('list')" style="margin-top:12px;padding:6px 16px;font-size:12px;">返回列表</button>
            </div>
        `;
        return;
    }

    const createdAt = new Date(survey.createdAt);
    const dateStr = `${createdAt.getFullYear()}/${String(createdAt.getMonth()+1).padStart(2,'0')}/${String(createdAt.getDate()).padStart(2,'0')} ${String(createdAt.getHours()).padStart(2,'0')}:${String(createdAt.getMinutes()).padStart(2,'0')}`;
    
    let repliesHTML = '';
    if (survey.replies && survey.replies.length > 0) {
        repliesHTML = survey.replies.map((reply, idx) => {
            const q = survey.questions[reply.questionIndex] || '(问题已删除)';
            const time = new Date(reply.timestamp);
            const timeStr = `${String(time.getHours()).padStart(2,'0')}:${String(time.getMinutes()).padStart(2,'0')}`;
            return `
                <div style="
                    display:flex;
                    flex-direction:column;
                    gap:4px;
                    padding:10px 12px;
                    background:var(--secondary-bg);
                    border-radius:10px;
                    border-left:3px solid var(--accent-color);
                    margin-bottom:8px;
                ">
                    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;">
                        <span style="font-size:12px;font-weight:600;color:var(--text-secondary);">Q${reply.questionIndex + 1}. ${q}</span>
                        <span style="font-size:10px;color:var(--text-secondary);opacity:0.6;">${timeStr}</span>
                    </div>
                    <div style="font-size:13px;color:var(--text-primary);padding:4px 8px 4px 0;word-break:break-word;">
                        <span style="color:var(--accent-color);">✦</span> ${reply.answer}
                    </div>
                </div>
            `;
        }).join('');
    } else {
        repliesHTML = `
            <div style="text-align:center;padding:20px;color:var(--text-secondary);opacity:0.6;font-size:13px;">
                <i class="fas fa-hourglass-start" style="display:block;font-size:24px;margin-bottom:8px;opacity:0.4;"></i>
                暂无回复记录
            </div>
        `;
    }

    container.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <button class="modal-btn modal-btn-secondary" onclick="switchSurveyView('list')" style="padding:6px 12px;font-size:12px;">
                <i class="fas fa-arrow-left"></i> 返回列表
            </button>
            <span style="font-size:14px;font-weight:600;color:var(--text-primary);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${survey.title}</span>
            <span style="font-size:11px;background:${survey.status === 'completed' ? '#6BCB7722' : 'var(--accent-color)22'};color:${survey.status === 'completed' ? '#6BCB77' : 'var(--accent-color)'};padding:2px 10px;border-radius:10px;">${survey.status === 'completed' ? '已完成' : '待回复'}</span>
        </div>

        <div style="font-size:11px;color:var(--text-secondary);margin-bottom:14px;display:flex;gap:12px;flex-wrap:wrap;padding:8px 12px;background:var(--primary-bg);border-radius:10px;">
            <span><i class="far fa-calendar-alt" style="margin-right:4px;"></i>创建于 ${dateStr}</span>
            <span><i class="far fa-file-alt" style="margin-right:4px;"></i>${survey.questions.length} 题</span>
            <span><i class="far fa-comment-dots" style="margin-right:4px;"></i>${survey.replies ? survey.replies.length : 0} 条回复</span>
        </div>

        <div style="max-height:45vh;overflow-y:auto;padding-right:4px;">
            ${repliesHTML}
        </div>

        ${survey.status === 'pending' ? `
            <div style="margin-top:14px;display:flex;gap:10px;">
                <button class="modal-btn modal-btn-primary" onclick="startSurveyAndReply('${survey.id}')" style="flex:1;">
                    <i class="fas fa-play"></i> 开始回复
                </button>
            </div>
        ` : `
            <div style="margin-top:14px;font-size:12px;color:var(--text-secondary);text-align:center;opacity:0.6;padding:8px;background:var(--primary-bg);border-radius:10px;">
                <i class="fas fa-check-circle" style="color:#6BCB77;"></i> 问卷已全部完成
            </div>
        `}
    `;
}

/**
 * 切换视图
 */
function switchSurveyView(view, surveyId) {
    currentSurveyView = view;
    const container = document.getElementById('survey-content');
    if (!container) return;
    
    if (view === 'detail' && surveyId) {
        container.dataset.surveyId = surveyId;
    } else {
        delete container.dataset.surveyId;
    }
    
    renderSurveyPanel();
}

/**
 * 提交创建问卷
 */
async function submitSurveyCreate() {
    const titleInput = document.getElementById('survey-title-input');
    const questionsInput = document.getElementById('survey-questions-input');
    const delayMin = document.getElementById('survey-delay-min');
    const delayMax = document.getElementById('survey-delay-max');

    const title = (titleInput ? titleInput.value : '').trim() || '未命名问卷';
    const questions = (questionsInput ? questionsInput.value : '')
        .split('\n')
        .map(q => q.trim())
        .filter(q => q);

    if (questions.length === 0) {
        showNotification('请至少输入一个问题', 'warning');
        return;
    }

    const minDelay = parseInt(delayMin ? delayMin.value : 3000);
    const maxDelay = parseInt(delayMax ? delayMax.value : 15000);

    const survey = await createSurvey(title, questions, minDelay, maxDelay);
    showNotification(`✅ 问卷 "${survey.title}" 已创建`, 'success');
    if (typeof playSound === 'function') playSound('favorite');
    
    switchSurveyView('list');
}

/**
 * 删除问卷
 */
async function deleteSurveyItem(surveyId) {
    if (!confirm('确定要删除这份问卷吗？')) return;
    await deleteSurvey(surveyId);
    showNotification('问卷已删除', 'success');
    renderSurveyPanel();
}

/**
 * 打开问卷详情
 */
async function openSurveyDetail(surveyId) {
    switchSurveyView('detail', surveyId);
}

/**
 * 开始问卷并让梦角回复
 */
async function startSurveyAndReply(surveyId) {
    const survey = await getSurvey(surveyId);
    if (!survey) {
        showNotification('问卷不存在', 'error');
        return;
    }

    if (survey.status === 'completed') {
        showNotification('问卷已完成，无法再次回复', 'info');
        return;
    }

    if (survey.questions.length === 0) {
        showNotification('问卷没有有效问题', 'warning');
        return;
    }

    // 检查字卡库
    const disabledItems = (() => {
        try {
            const raw = localStorage.getItem('disabledReplyItems');
            return raw ? new Set(JSON.parse(raw)) : new Set();
        } catch { return new Set(); }
    })();
    const disabledGroupItems = new Set();
    (window.customReplyGroups || []).forEach(g => {
        if (g.disabled && Array.isArray(g.items)) {
            g.items.forEach(item => disabledGroupItems.add(item));
        }
    });
    const replyPool = (customReplies || [])
        .filter(r => !disabledItems.has(r) && !disabledGroupItems.has(r))
        .map(r => String(r || '').trim())
        .filter(Boolean);

    if (replyPool.length === 0) {
        showNotification('字卡库为空，无法完成问卷。请先添加字卡', 'warning', 4000);
        return;
    }

    showNotification(`📋 开始让梦角回答 "${survey.title}"...`, 'info', 3000);
    
    // 显示打字指示器
    if (settings.typingIndicatorEnabled) {
        showSurveyTypingIndicator(true);
    }

    // 逐题回复
    let completed = 0;
    const total = survey.questions.length;

    // 使用已有的 simulateSurveyReply，传入回调更新UI
    const updatedSurvey = await simulateSurveyReply(surveyId, (index, answer) => {
        completed++;
        // 更新列表中的进度
        const listEl = document.getElementById('survey-list');
        if (listEl) {
            const card = listEl.querySelector(`[data-survey-id="${surveyId}"]`);
            if (card) {
                const progressEl = card.querySelector('.survey-progress');
                if (progressEl) {
                    progressEl.textContent = `${completed}/${total}`;
                }
            }
        }
        // 如果当前在详情页，刷新详情
        if (currentSurveyView === 'detail' && document.getElementById('survey-content')?.dataset?.surveyId === surveyId) {
            renderSurveyDetail(document.getElementById('survey-content'));
        }
        // 每答完一题触发通知
        if (typeof playSound === 'function') playSound('message');
    });

    // 隐藏打字指示器
    if (settings.typingIndicatorEnabled) {
        setTimeout(() => showSurveyTypingIndicator(false), 500);
    }

    if (updatedSurvey) {
        showNotification(`✅ 问卷 "${survey.title}" 已完成，共 ${updatedSurvey.replies.length} 条回复`, 'success', 4000);
        if (typeof playSound === 'function') playSound('favorite');
    }

    // 刷新列表
    renderSurveyPanel();
}

/**
 * 显示/隐藏问卷打字指示器
 */
let surveyTypingTimer = null;

function showSurveyTypingIndicator(show) {
    const wrapper = document.getElementById('typing-indicator-wrapper');
    if (!wrapper) return;
    
    if (show) {
        const label = document.getElementById('typing-indicator-label');
        if (label) label.textContent = (settings.partnerName || '对方') + ' 正在认真回答问卷...';
        const avatar = document.getElementById('typing-indicator-avatar');
        if (avatar) {
            const partnerImg = DOMElements.partner.avatar.querySelector('img');
            avatar.innerHTML = partnerImg ? `<img src="${partnerImg.src}">` : '<i class="fas fa-user"></i>';
        }
        positionTypingIndicator();
        wrapper.style.display = 'block';
        DOMElements.chatContainer.scrollTop = DOMElements.chatContainer.scrollHeight;
        
        clearTimeout(surveyTypingTimer);
    } else {
        // 延迟隐藏，让过渡更自然
        clearTimeout(surveyTypingTimer);
        surveyTypingTimer = setTimeout(() => {
            wrapper.style.display = 'none';
        }, 400);
    }
}

/**
 * 在聊天中发送问卷回复（可选功能）
 */
async function sendSurveyReplyToChat(surveyId) {
    const survey = await getSurvey(surveyId);
    if (!survey || survey.replies.length === 0) return;

    let message = `📋 问卷「${survey.title}」\n`;
    survey.replies.forEach((reply, idx) => {
        const q = survey.questions[reply.questionIndex] || '(问题已删除)';
        message += `\n${idx+1}. ${q}\n   ✦ ${reply.answer}`;
    });
    
    addMessage({
        id: Date.now(),
        sender: settings.partnerName || '对方',
        text: message,
        timestamp: new Date(),
        status: 'received',
        type: 'normal'
    });
    if (typeof playSound === 'function') playSound('message');
}

// ===== 初始化入口 =====

/**
 * 初始化问卷功能
 */
function initSurveyModule() {
    const entryBtn = document.getElementById('survey-function');
    if (!entryBtn) return;

    // 移除旧监听，防止重复绑定
    const newBtn = entryBtn.cloneNode(true);
    entryBtn.parentNode.replaceChild(newBtn, entryBtn);

    newBtn.addEventListener('click', async () => {
        // 关闭高级功能弹窗
        const advancedModal = document.getElementById('advanced-modal');
        if (advancedModal && typeof hideModal === 'function') {
            hideModal(advancedModal);
        }
        
        // 显示问卷弹窗
        const surveyModal = document.getElementById('survey-modal');
        if (surveyModal) {
            // 重置视图到列表
            currentSurveyView = 'list';
            const container = document.getElementById('survey-content');
            if (container) delete container.dataset.surveyId;
            await renderSurveyPanel();
            if (typeof showModal === 'function') {
                showModal(surveyModal);
            }
        }
    });

    // 关闭按钮
    const closeBtn = document.getElementById('close-survey-modal');
    if (closeBtn) {
        const newClose = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newClose, closeBtn);
        newClose.addEventListener('click', () => {
            const modal = document.getElementById('survey-modal');
            if (modal && typeof hideModal === 'function') {
                hideModal(modal);
            }
        });
    }

    // 导出/导入功能（可选）
    const exportBtn = document.getElementById('survey-export-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', async () => {
            const surveys = await loadSurveys();
            if (surveys.length === 0) {
                showNotification('没有问卷可导出', 'warning');
                return;
            }
            const dataStr = JSON.stringify(surveys, null, 2);
            const blob = new Blob([dataStr], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `surveys-backup-${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showNotification('问卷已导出', 'success');
        });
    }

    const importBtn = document.getElementById('survey-import-btn');
    const importInput = document.getElementById('survey-import-input');
    if (importBtn && importInput) {
        importBtn.addEventListener('click', () => importInput.click());
        importInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                const text = await file.text();
                const data = JSON.parse(text);
                if (!Array.isArray(data)) throw new Error('格式错误');
                const existing = await loadSurveys();
                const merged = [...data, ...existing];
                await saveSurveys(merged);
                showNotification(`✅ 导入了 ${data.length} 份问卷`, 'success');
                renderSurveyPanel();
            } catch (err) {
                showNotification('导入失败：文件格式不正确', 'error');
            }
            importInput.value = '';
        });
    }
}

/**
 * 调试：查看当前字卡库状态
 */
window.debugSurveyReplies = async function() {
    console.log('=== 问卷调试信息 ===');
    console.log('customReplies (全局):', typeof customReplies !== 'undefined' ? customReplies : 'undefined');
    console.log('window.customReplies:', window.customReplies);
    
    try {
        const stored = await localforage.getItem(getStorageKey('customReplies'));
        console.log('localStorage 中的字卡:', stored);
    } catch(e) {
        console.log('无法读取存储:', e);
    }
    
    const disabled = localStorage.getItem('disabledReplyItems');
    console.log('被屏蔽的字卡:', disabled ? JSON.parse(disabled) : '无');
    
    console.log('=== 调试结束 ===');
};

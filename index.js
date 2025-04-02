import { extension_settings, loadExtensionSettings } from "../../../extensions.js";
import { saveSettingsDebounced, eventSource, event_types } from "../../../../script.js";
import { getContext } from "../../../extensions.js";

const extensionName = "hide-helper";
const defaultSettings = {
    // 保留全局默认设置用于向后兼容
    hideLastN: 0,
    lastAppliedSettings: null,
    enabled: true
};

// 缓存上下文
let cachedContext = null;

// 获取优化的上下文
function getContextOptimized() {
    if (!cachedContext) {
        cachedContext = getContext();
    }
    return cachedContext;
}

// 初始化扩展设置
function loadSettings() {
    extension_settings[extensionName] = extension_settings[extensionName] || {};
    if (Object.keys(extension_settings[extensionName]).length === 0) {
        Object.assign(extension_settings[extensionName], defaultSettings);
    }
    // 确保启用状态存在
    if (typeof extension_settings[extensionName].enabled === 'undefined') {
        extension_settings[extensionName].enabled = true;
    }
}

// 创建UI面板 - 修改为简化版本，只有开启/关闭选项
function createUI() {
    const settingsHtml = `
    <div id="hide-helper-settings" class="hide-helper-container">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>隐藏助手</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">
                <div class="hide-helper-section">
                    <!-- 开启/关闭选项 -->
                    <div class="hide-helper-toggle-row">
                        <span class="hide-helper-label">插件状态:</span>
                        <select id="hide-helper-toggle">
                            <option value="enabled">开启</option>
                            <option value="disabled">关闭</option>
                        </select>
                    </div>
                </div>
                <hr class="sysHR">
            </div>
        </div>
    </div>`;
    
    // 将UI添加到SillyTavern扩展设置区域
    $("#extensions_settings").append(settingsHtml);
    
    // 创建聊天输入区旁边的按钮
    createInputWandButton();
    
    // 创建弹出对话框
    createPopup();
    
    // 设置事件监听器
    setupEventListeners();
}

// 新增：创建输入区旁的按钮
function createInputWandButton() {
    const buttonHtml = `
    <div id="hide-helper-wand-button" class="list-group-item flex-container flexGap5" title="隐藏助手">
        <span style="padding-top: 2px;">
            <i class="fa-solid fa-ghost"></i>
        </span>
        <span>隐藏助手</span>
    </div>`;
    
    $('#data_bank_wand_container').append(buttonHtml);
}

// 新增：创建弹出对话框
function createPopup() {
    const popupHtml = `
    <div id="hide-helper-popup" class="hide-helper-popup">
        <div class="hide-helper-popup-title">隐藏助手设置</div>
        
        <!-- 输入行 - 保存设置按钮 + 输入框 + 取消隐藏按钮 -->
        <div class="hide-helper-input-row">
            <button id="hide-save-settings-btn" class="hide-helper-btn">保存设置</button>
            <input type="number" id="hide-last-n" min="0" placeholder="隐藏最近N楼之前的消息">
            <button id="hide-unhide-all-btn" class="hide-helper-btn">取消隐藏</button>
        </div>
        
        <!-- 当前隐藏设置 -->
        <div class="hide-helper-current">
            <strong>当前隐藏设置:</strong> <span id="hide-current-value">无</span>
        </div>
        
        <!-- 底部关闭按钮 -->
        <div class="hide-helper-popup-footer">
            <button id="hide-helper-popup-close" class="hide-helper-close-btn">关闭</button>
        </div>
    </div>`;
    
    $('body').append(popupHtml);
}

// 获取当前角色/群组的隐藏设置
function getCurrentHideSettings() {
    const context = getContextOptimized();
    const isGroup = !!context.groupId;
    const target = isGroup 
        ? context.groups.find(x => x.id == context.groupId)
        : context.characters[context.characterId];
    
    if (!target) return null;
    
    // 检查是否有保存的设置
    if (target.data?.hideHelperSettings) {
        return target.data.hideHelperSettings;
    }
    
    // 没有则返回null
    return null;
}

// 保存当前角色/群组的隐藏设置
function saveCurrentHideSettings(hideLastN) {
    const context = getContextOptimized();
    const isGroup = !!context.groupId;
    const target = isGroup 
        ? context.groups.find(x => x.id == context.groupId)
        : context.characters[context.characterId];
    
    if (!target) return false;
    
    // 初始化data对象如果不存在
    target.data = target.data || {};
    target.data.hideHelperSettings = target.data.hideHelperSettings || {};
    
    // 保存设置
    target.data.hideHelperSettings.hideLastN = hideLastN;
    target.data.hideHelperSettings.lastProcessedLength = context.chat?.length || 0;
    // 添加一个标志，表示用户已明确设置过隐藏规则
    target.data.hideHelperSettings.userConfigured = true;
    
    // 关键修复：调用适当的保存函数将更改持久化到磁盘
    if (isGroup) {
        if (typeof context.saveGroupDebounced === 'function') {
            context.saveGroupDebounced();
        }
    } else {
        if (typeof context.saveCharacterDebounced === 'function') {
            context.saveCharacterDebounced();
        }
    }
    
    return true;
}

// 更新当前设置显示
function updateCurrentHideSettingsDisplay() {
    const currentSettings = getCurrentHideSettings();
    const displayElement = document.getElementById('hide-current-value');
    
    if (!displayElement) return;
    
    if (!currentSettings || currentSettings.hideLastN === 0) {
        displayElement.textContent = '无';
    } else {
        displayElement.textContent = currentSettings.hideLastN;
    }
}

// 防抖函数
function debounce(fn, delay) {
    let timer;
    return function(...args) {
        clearTimeout(timer);
        timer = setTimeout(() => fn.apply(this, args), delay);
    };
}

// 防抖版本的全量检查
const runFullHideCheckDebounced = debounce(runFullHideCheck, 200);

/**
 * 检查是否应该执行隐藏/取消隐藏操作
 * 只有当用户明确设置过隐藏规则并且插件启用时才返回true
 */
function shouldProcessHiding() {
    // 检查插件是否启用
    if (!extension_settings[extensionName].enabled) {
        console.log(`[${extensionName}] Skipping hide processing: Plugin disabled.`);
        return false;
    }
    
    const settings = getCurrentHideSettings();
    // 如果没有设置，或者用户没有明确配置过，则不处理
    if (!settings || settings.userConfigured !== true) {
        console.log(`[${extensionName}] Skipping hide processing: No user-configured settings found.`);
        return false;
    }
    return true;
}

/**
 * 增量隐藏检查 (用于新消息到达)
 * 仅处理从上次处理长度到现在新增的、需要隐藏的消息
 */
function runIncrementalHideCheck() {
    // 首先检查是否应该执行隐藏操作
    if (!shouldProcessHiding()) return;

    const startTime = performance.now();
    const context = getContextOptimized();
    const chat = context.chat;
    const currentChatLength = chat?.length || 0;
    const settings = getCurrentHideSettings() || { hideLastN: 0, lastProcessedLength: 0 };
    const { hideLastN, lastProcessedLength = 0 } = settings;

    // --- 前置条件检查 ---
    if (currentChatLength === 0 || hideLastN <= 0) {
        // 如果 N=0 或无消息，增量无意义。但如果长度变长了，需要更新 lastProcessedLength
        if (currentChatLength > lastProcessedLength) {
            settings.lastProcessedLength = currentChatLength;
            // 只在长度变化时保存设置
            saveCurrentHideSettings(hideLastN);
        }
        console.log(`[${extensionName}] Incremental check skipped: No chat, hideLastN<=0.`);
        return;
    }

    if (currentChatLength <= lastProcessedLength) {
        // 长度未增加或减少，说明可能发生删除或其他异常，应由 Full Check 处理
        console.log(`[${extensionName}] Incremental check skipped: Chat length did not increase (${lastProcessedLength} -> ${currentChatLength}). Might be a delete.`);
        // 这里不主动调用 Full Check，依赖 MESSAGE_DELETED 事件或下次 CHAT_CHANGED 处理
        return;
    }

    // --- 计算范围 ---
    const targetVisibleStart = currentChatLength - hideLastN;
    const previousVisibleStart = lastProcessedLength > 0 ? lastProcessedLength - hideLastN : 0; // 处理首次的情况

    // 必须目标 > 先前才有新增隐藏
    if (targetVisibleStart > previousVisibleStart && previousVisibleStart >= 0) {
        const toHideIncrementally = [];
        const startIndex = Math.max(0, previousVisibleStart); // 确保不为负
        const endIndex = Math.min(currentChatLength, targetVisibleStart); // 确保不超过当前长度

        // --- 收集需要隐藏的消息 ---
        for (let i = startIndex; i < endIndex; i++) {
            // 移除 !chat[i].is_user 条件，允许隐藏用户消息
            if (chat[i] && chat[i].is_system === false) {
                toHideIncrementally.push(i);
            }
        }

        // --- 执行批量更新 ---
        if (toHideIncrementally.length > 0) {
            console.log(`[${extensionName}] Incrementally hiding messages: ${toHideIncrementally.join(', ')}`);

            // 1. 批量更新数据 (chat 数组)
            toHideIncrementally.forEach(idx => { if (chat[idx]) chat[idx].is_system = true; });

            // 2. 批量更新 DOM
            try {
                // 使用属性选择器而不是类选择器，通常更快
                const hideSelector = toHideIncrementally.map(id => `[mesid="${id}"]`).join(',');
                if (hideSelector) {
                    $(hideSelector).attr('is_system', 'true');
                }
            } catch (error) {
                console.error(`[${extensionName}] Error updating DOM incrementally:`, error);
            }

            // 3. 延迟保存 Chat (包含 is_system 的修改)
            setTimeout(() => context.saveChatDebounced?.(), 100);
        } else {
            console.log(`[${extensionName}] Incremental check: No messages needed hiding in the new range [${startIndex}, ${endIndex}).`);
        }
    } else {
        console.log(`[${extensionName}] Incremental check: Visible start did not advance or range invalid.`);
    }

    // --- 更新处理长度并保存设置 ---
    if (settings.lastProcessedLength !== currentChatLength) {
        settings.lastProcessedLength = currentChatLength;
        // 只在实际有变化时保存
        if (toHideIncrementally.length > 0) {
            saveCurrentHideSettings(hideLastN);
        }
    }
    
    console.log(`[${extensionName}] Incremental check completed in ${performance.now() - startTime}ms`);
}

/**
 * 全量隐藏检查 (优化的差异更新)
 * 用于加载、切换、删除、设置更改等情况
 */
function runFullHideCheck() {
    // 首先检查是否应该执行隐藏操作
    if (!shouldProcessHiding()) return;

    const startTime = performance.now();
    console.log(`[${extensionName}] Running optimized full hide check.`);
    const context = getContextOptimized();
    const chat = context.chat;
    const currentChatLength = chat?.length || 0;

    // 加载当前角色的设置，如果 chat 不存在则无法继续
    const settings = getCurrentHideSettings() || { hideLastN: 0, lastProcessedLength: 0 };
    if (!chat) {
        console.warn(`[${extensionName}] Full check aborted: Chat data not available.`);
        // 重置处理长度可能不安全，因为不知道状态
        return;
    }
    const { hideLastN } = settings;

    // 1. 优化初始检查 (N > 0 且 N >= length -> 全部可见)
    if (hideLastN > 0 && hideLastN >= currentChatLength) {
        const needsToShowAny = chat.some(msg => msg && msg.is_system === true);
        if (!needsToShowAny) {
            console.log(`[${extensionName}] Full check (N=${hideLastN}): No messages are hidden or all should be visible, skipping.`);
            settings.lastProcessedLength = currentChatLength; // 即使跳过也要更新长度
            saveCurrentHideSettings(hideLastN);
            return; // 无需操作
        }
        // 如果需要显示，则继续执行下面的逻辑，visibleStart 会是 0
    }

    // 2. 计算可见边界 - 修复：当 hideLastN = 0 时，visibleStart 应该等于 currentChatLength（即没有可见消息）
    const visibleStart = (hideLastN > 0 && hideLastN < currentChatLength) 
        ? currentChatLength - hideLastN 
        : (hideLastN === 0 ? currentChatLength : 0); // 当 N=0 时，所有消息都应隐藏

    // 3. 差异计算 (结合跳跃扫描)
    const toHide = [];
    const toShow = [];
    const SKIP_STEP = 10; // 跳跃扫描步长

    // 检查需要隐藏的部分 (0 to visibleStart - 1)
    for (let i = 0; i < visibleStart; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const isCurrentlyHidden = msg.is_system === true;

        // 移除 !msg.is_user 条件，允许隐藏用户消息
        if (!isCurrentlyHidden) {
            toHide.push(i);
        } else if (isCurrentlyHidden) {
            // 跳跃扫描逻辑
            let lookAhead = 1;
            const maxLookAhead = Math.min(visibleStart, i + SKIP_STEP); // 检查未来步长或到边界
            while (i + lookAhead < maxLookAhead) {
                const nextMsg = chat[i + lookAhead];
                const nextIsHidden = nextMsg && nextMsg.is_system === true;
                if (!nextIsHidden) break; // 遇到非隐藏的，停止跳跃
                lookAhead++;
            }
            if (lookAhead > 1) {
                i += (lookAhead - 1); // 跳过检查过的 hidden 消息
            }
        }
    }
    
    // 检查需要显示的部分 (visibleStart to currentChatLength - 1)
    for (let i = visibleStart; i < currentChatLength; i++) {
        const msg = chat[i];
        if (!msg) continue;
        const isCurrentlyHidden = msg.is_system === true;

        // 移除 !msg.is_user 条件，允许显示用户消息
        if (isCurrentlyHidden) {
            toShow.push(i);
        } else if (!isCurrentlyHidden) {
            // 跳跃扫描逻辑 (检查 is_system === false)
            let lookAhead = 1;
            const maxLookAhead = Math.min(currentChatLength, i + SKIP_STEP);
            while (i + lookAhead < maxLookAhead) {
                const nextMsg = chat[i + lookAhead];
                const nextIsVisible = nextMsg && nextMsg.is_system === false;
                if (!nextIsVisible) break;
                lookAhead++;
            }
            if (lookAhead > 1) {
                i += (lookAhead - 1);
            }
        }
    }

    // 4. 批量处理 (Data & DOM)
    let changed = false;
    // --- 更新数据 ---
    if (toHide.length > 0) {
        changed = true;
        toHide.forEach(idx => { if (chat[idx]) chat[idx].is_system = true; });
    }
    if (toShow.length > 0) {
        changed = true;
        toShow.forEach(idx => { if (chat[idx]) chat[idx].is_system = false; });
    }

    // --- 更新 DOM ---
    try {
        if (toHide.length > 0) {
            // 使用属性选择器而不是类选择器
            const hideSelector = toHide.map(id => `[mesid="${id}"]`).join(',');
            if (hideSelector) $(hideSelector).attr('is_system', 'true');
        }
        if (toShow.length > 0) {
            const showSelector = toShow.map(id => `[mesid="${id}"]`).join(',');
            if (showSelector) $(showSelector).attr('is_system', 'false');
        }
    } catch (error) {
        console.error(`[${extensionName}] Error updating DOM in full check:`, error);
    }

    // 5. 后续处理
    if (changed) {
        console.log(`[${extensionName}] Optimized Full check: Hiding ${toHide.length}, Showing ${toShow.length}`);
        // 延迟保存 Chat (包含 is_system 的修改)
        setTimeout(() => context.saveChatDebounced?.(), 100);
    } else {
        console.log(`[${extensionName}] Optimized Full check: No changes needed.`);
    }

    // 更新处理长度并保存设置
    if (settings.lastProcessedLength !== currentChatLength) {
        settings.lastProcessedLength = currentChatLength;
        saveCurrentHideSettings(hideLastN);
    }
    
    console.log(`[${extensionName}] Full check completed in ${performance.now() - startTime}ms`);
}

// 新增：全部取消隐藏功能
function unhideAllMessages() {
    const startTime = performance.now();
    console.log(`[${extensionName}] Unhiding all messages.`);
    const context = getContextOptimized();
    const chat = context.chat;
    
    if (!chat || chat.length === 0) {
        console.warn(`[${extensionName}] Unhide all aborted: Chat data not available or empty.`);
        return;
    }
    
    // 找出所有当前隐藏的消息
    const toShow = [];
    for (let i = 0; i < chat.length; i++) {
        if (chat[i] && chat[i].is_system === true) {
            toShow.push(i);
        }
    }
    
    // 批量更新数据和DOM
    if (toShow.length > 0) {
        // 更新数据
        toShow.forEach(idx => { if (chat[idx]) chat[idx].is_system = false; });
        
        // 更新DOM
        try {
            const showSelector = toShow.map(id => `[mesid="${id}"]`).join(',');
            if (showSelector) $(showSelector).attr('is_system', 'false');
        } catch (error) {
            console.error(`[${extensionName}] Error updating DOM when unhiding all:`, error);
        }
        
        // 保存聊天
        setTimeout(() => context.saveChatDebounced?.(), 100);
        console.log(`[${extensionName}] Unhide all: Showed ${toShow.length} messages`);
    } else {
        console.log(`[${extensionName}] Unhide all: No hidden messages found.`);
    }
    
    // 重要修改：重置隐藏设置为0，并更新UI
    saveCurrentHideSettings(0);
    updateCurrentHideSettingsDisplay();
    
    // 更新输入框显示
    const hideLastNInput = document.getElementById('hide-last-n');
    if (hideLastNInput) {
        hideLastNInput.value = '';
    }
    
    console.log(`[${extensionName}] Unhide all completed in ${performance.now() - startTime}ms`);
}

// 设置UI元素的事件监听器
function setupEventListeners() {
    // 设置弹出对话框按钮事件
    $('#hide-helper-wand-button').on('click', function() {
        // 只有在插件启用状态下才显示弹出框
        if (extension_settings[extensionName].enabled) {
            // 获取弹出框元素
            const popup = $('#hide-helper-popup');
            
            // 首先显示弹出框但设为不可见，以便我们可以获取其尺寸
            popup.css({
                'display': 'block',
                'visibility': 'hidden',
                'position': 'fixed',
                'left': '50%',
                'transform': 'translateX(-50%)'
            });
            
            // 更新输入框显示当前值
            const currentSettings = getCurrentHideSettings();
            const hideLastNInput = document.getElementById('hide-last-n');
            if (hideLastNInput) {
                hideLastNInput.value = currentSettings?.hideLastN || '';
            }
            
            // 更新当前设置显示
            updateCurrentHideSettingsDisplay();
            
            // 获取弹出框高度
            const popupHeight = popup.outerHeight();
            const windowHeight = $(window).height();
            
            // 计算顶部位置 - 在视窗中央，但确保完全可见
            // 距离底部至少100px
            const topPosition = Math.min(
                (windowHeight - popupHeight) / 2,  // 居中位置
                windowHeight - popupHeight - 100   // 距底部至少100px
            );
            
            // 确保顶部位置不小于10px（避免贴紧顶部）
            const finalTopPosition = Math.max(10, topPosition);
            
            // 设置最终位置并使弹出框可见
            popup.css({
                'top': finalTopPosition + 'px',
                'visibility': 'visible'
            });
        } else {
            toastr.warning('隐藏助手当前已禁用，请在扩展设置中启用。');
        }
    });
    
    // 弹出框关闭按钮事件
    $('#hide-helper-popup-close').on('click', function() {
        $('#hide-helper-popup').hide();
    });
    
    // 设置选项更改事件
    $('#hide-helper-toggle').on('change', function() {
        const isEnabled = $(this).val() === 'enabled';
        extension_settings[extensionName].enabled = isEnabled;
        saveSettingsDebounced();
        
        if (isEnabled) {
            toastr.success('隐藏助手已启用');
            // 启用时，执行一次全量检查来恢复之前的隐藏状态
            runFullHideCheckDebounced();
        } else {
            toastr.warning('隐藏助手已禁用');
            // 禁用时，可以考虑是否需要取消所有隐藏
            // 此处选择不自动取消隐藏，让用户可以保留隐藏状态并随时重新启用
        }
    });
    
    const hideLastNInput = document.getElementById('hide-last-n');
    
    if (hideLastNInput) {
        // 监听输入变化
        hideLastNInput.addEventListener('input', (e) => {
            const value = parseInt(e.target.value) || 0;
            hideLastNInput.value = value >= 0 ? value : '';
        });
    }

    // 保存设置按钮
    $('#hide-save-settings-btn').on('click', function() {
        const value = parseInt(hideLastNInput.value) || 0;
        if (saveCurrentHideSettings(value)) {
            runFullHideCheck(); // 使用优化的全量检查
            updateCurrentHideSettingsDisplay();
            toastr.success('隐藏设置已保存');
        } else {
            toastr.error('无法保存设置');
        }
    });
    
    // 全部取消隐藏按钮
    $('#hide-unhide-all-btn').on('click', function() {
        unhideAllMessages();
        toastr.success('已取消所有消息的隐藏');
    });

    // 监听聊天切换事件
    eventSource.on(event_types.CHAT_CHANGED, () => {
        // 清除上下文缓存
        cachedContext = null;
        
        // 更新插件启用/禁用状态显示
        $('#hide-helper-toggle').val(extension_settings[extensionName].enabled ? 'enabled' : 'disabled');
        
        if (hideLastNInput) {
            const currentSettings = getCurrentHideSettings();
            hideLastNInput.value = currentSettings?.hideLastN || '';
            updateCurrentHideSettingsDisplay();
            // 聊天切换时执行全量检查
            if (extension_settings[extensionName].enabled) {
                runFullHideCheckDebounced();
            }
        }
    });

    // 监听新消息事件
    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        // 使用增量检查处理新消息
        if (extension_settings[extensionName].enabled) {
            setTimeout(runIncrementalHideCheck, 10);
        }
    });
    
    // 添加对消息发送事件的监听
    eventSource.on(event_types.MESSAGE_SENT, () => {
        // 使用增量检查处理新发送的消息
        if (extension_settings[extensionName].enabled) {
            setTimeout(runIncrementalHideCheck, 10);
        }
    });
    
    // 监听消息删除事件
    eventSource.on(event_types.MESSAGE_DELETED, () => {
        console.log(`[${extensionName}] Event ${event_types.MESSAGE_DELETED} received. Running full check.`);
        // 使用防抖版本的全量检查
        if (extension_settings[extensionName].enabled) {
            runFullHideCheckDebounced();
        }
    });
}

// 初始化扩展
jQuery(async () => {
    loadSettings();
    createUI();
    
    // 初始加载时更新显示
    setTimeout(() => {
        // 设置启用/禁用选择框的当前值
        $('#hide-helper-toggle').val(extension_settings[extensionName].enabled ? 'enabled' : 'disabled');
        
        const currentSettings = getCurrentHideSettings();
        const hideLastNInput = document.getElementById('hide-last-n');
        if (hideLastNInput) {
            hideLastNInput.value = currentSettings?.hideLastN || '';
        }
        updateCurrentHideSettingsDisplay();
        // 初始加载时执行全量检查，但只有在用户已配置过设置且插件启用时才执行
        if (extension_settings[extensionName].enabled) {
            runFullHideCheck();
        }
    }, 1000);
});

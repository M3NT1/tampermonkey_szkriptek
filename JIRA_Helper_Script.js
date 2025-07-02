// ==UserScript==
// @name         JIRA Helper Script
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  JIRA oldal funkcionalitás bővítő script
// @author       Kasnyík László
// @match        https://jira.ulyssys.hu/browse/MAKSMIIERGINOP-*
// @grant        none
// @run-at       document-ready
// ==/UserScript==

(function() {
    'use strict';

    // Konfiguráció
    const CONFIG = {
        AUTO_REFRESH_INTERVAL: 30000, // 30 másodperc
        DEBUG: true,
        FEATURES: {
            quickActions: true,
            issueEnhancements: true,
            autoRefresh: false,
            keyboardShortcuts: true
        },
        // Support team tagok listája
        SUPPORT_TEAM: [
            'Láng Benedek',
            'Kürtösi Zoltán',
            'Illyés Zoltán',
            'Mijsák Mihály'
        ]
    };

    // Debug log függvény
    function debugLog(message, data = null) {
        if (CONFIG.DEBUG) {
            console.log(`[JIRA Helper] ${message}`, data || '');
        }
    }

    // Várakozás az elem megjelenésére
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const element = document.querySelector(selector);
            if (element) {
                resolve(element);
                return;
            }

            const observer = new MutationObserver((mutations, obs) => {
                const element = document.querySelector(selector);
                if (element) {
                    obs.disconnect();
                    resolve(element);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Element not found: ${selector}`));
            }, timeout);
        });
    }

    // Issue adatok kinyerése
    function getIssueData() {
        const issueKey = document.querySelector('#key-val')?.textContent?.trim();
        const summary = document.querySelector('#summary-val')?.textContent?.trim();
        const status = document.querySelector('#status-val .jira-issue-status-lozenge')?.textContent?.trim();
        const type = document.querySelector('#type-val')?.textContent?.trim();
        const priority = document.querySelector('.priority img')?.title;
        const assignee = document.querySelector('#assignee-val')?.textContent?.trim();

        return {
            key: issueKey,
            summary: summary,
            status: status,
            type: type,
            priority: priority,
            assignee: assignee
        };
    }

    // Assignee alapján kategória meghatározása
    function getCategory(assignee) {
        if (!assignee || assignee === 'Unassigned' || assignee === '-' || assignee === '') {
            return '2025_új_Fejlesztés';
        }
        
        // Ellenőrizzük, hogy az assignee a support team tagjai között van-e
        const isSupportMember = CONFIG.SUPPORT_TEAM.some(member => 
            assignee.toLowerCase().includes(member.toLowerCase()) || 
            member.toLowerCase().includes(assignee.toLowerCase())
        );
        
        return isSupportMember ? '2025_új_support' : '2025_új_Fejlesztés';
    }

    // Worklog kerekítés speciális szabályok szerint
    function roundWorklogHours(hours) {
        const decimalPart = hours - Math.floor(hours);
        const wholePart = Math.floor(hours);
        
        if (decimalPart >= 0.0 && decimalPart <= 0.4) {
            // x.0-tól x.4-ig lefelé kerekítés
            return wholePart.toFixed(1);
        } else if (decimalPart === 0.5) {
            // x.5 fél órát jelent (marad 0.5)
            return (wholePart + 0.5).toFixed(1);
        } else if (decimalPart >= 0.6 && decimalPart <= 0.9) {
            // x.6-7-8-9 egész órát jelent felfelé kerekítve
            return (wholePart + 1).toFixed(1);
        } else {
            // Biztonsági esetkezelés
            return hours.toFixed(1);
        }
    }

    // Worklog összeg kinyerése
    function getTotalWorklog() {
        try {
            let totalMinutes = 0;
            
            // 1. Próbáljuk meg a Time Tracking modulból (új JIRA layout)
            const timeSpentElement = document.querySelector('#tt_single_values_spent');
            if (timeSpentElement) {
                const timeSpentText = timeSpentElement.textContent.trim();
                debugLog('Time Spent elem található:', timeSpentText);
                
                if (timeSpentText && timeSpentText !== 'Not Specified' && timeSpentText !== '-' && timeSpentText !== '0h') {
                    // Formátum: "152h 13m" vagy "18.15h" vagy "1h 50m" vagy "2h" vagy "45m"
                    debugLog('Worklog szöveg feldolgozása:', timeSpentText);
                    
                    // Először próbáljuk meg tizedes órák formátumát (pl. "18.15h")
                    const decimalHourMatch = timeSpentText.match(/^(\d+(?:\.\d+)?)\s*h$/);
                    if (decimalHourMatch) {
                        const hours = parseFloat(decimalHourMatch[1]);
                        totalMinutes = hours * 60;
                        debugLog('Tizedes óra formátum találat:', hours + ' óra');
                    } else {
                        // Ha nem tiszta tizedes, akkor keressük a hagyományos formátumot (óra + perc)
                        const timeUnits = timeSpentText.match(/(\d+)\s*([dhm])/g);
                        if (timeUnits) {
                            debugLog('Hagyományos formátum találat:', timeUnits);
                            timeUnits.forEach(unit => {
                                const match = unit.match(/(\d+)\s*([dhm])/);
                                if (match) {
                                    const value = parseInt(match[1]);
                                    const unit = match[2];
                                    
                                    switch(unit) {
                                        case 'd': // nap
                                            totalMinutes += value * 8 * 60; // 8 óra = 1 nap
                                            break;
                                        case 'h': // óra
                                            totalMinutes += value * 60;
                                            break;
                                        case 'm': // perc
                                            totalMinutes += value;
                                            break;
                                    }
                                }
                            });
                        }
                    }
                }
            } else {
                debugLog('Time Spent elem nem található');
            }
            
            // 2. Ha nem találtuk meg, próbáljuk a hagyományos worklog modulból
            if (totalMinutes === 0) {
                debugLog('Keresés hagyományos worklog modulban...');
                const worklogModule = document.querySelector('#worklog-module, #worklogmodule');
                if (worklogModule) {
                    const worklogEntries = worklogModule.querySelectorAll('.worklog-duration, .duration');
                    worklogEntries.forEach(entry => {
                        const durationText = entry.textContent.trim();
                        debugLog('Worklog bejegyzés:', durationText);
                        
                        const timeUnits = durationText.match(/(\d+)\s*([dhm])/g);
                        if (timeUnits) {
                            timeUnits.forEach(unit => {
                                const match = unit.match(/(\d+)\s*([dhm])/);
                                if (match) {
                                    const value = parseInt(match[1]);
                                    const unit = match[2];
                                    
                                    switch(unit) {
                                        case 'd': // nap
                                            totalMinutes += value * 8 * 60; // 8 óra = 1 nap
                                            break;
                                        case 'h': // óra
                                            totalMinutes += value * 60;
                                            break;
                                        case 'm': // perc
                                            totalMinutes += value;
                                            break;
                                    }
                                }
                            });
                        }
                    });
                } else {
                    debugLog('Worklog modul nem található');
                }
            }
            
            // 3. Ha még mindig nincs eredmény, próbáljuk a .tt_values class-t
            if (totalMinutes === 0) {
                debugLog('Keresés .tt_values class-ban...');
                const ttValues = document.querySelectorAll('.tt_values');
                ttValues.forEach(element => {
                    const text = element.textContent.trim();
                    if (text.includes('h') && text.length < 15) { // Rövid szövegek
                        debugLog('TT Values elem:', text);
                        const timeUnits = text.match(/(\d+)\s*([dhm])/g);
                        if (timeUnits && totalMinutes === 0) { // Csak az első találatot használjuk
                            timeUnits.forEach(unit => {
                                const match = unit.match(/(\d+)\s*([dhm])/);
                                if (match) {
                                    const value = parseInt(match[1]);
                                    const unit = match[2];
                                    
                                    switch(unit) {
                                        case 'd': // nap
                                            totalMinutes += value * 8 * 60;
                                            break;
                                        case 'h': // óra
                                            totalMinutes += value * 60;
                                            break;
                                        case 'm': // perc
                                            totalMinutes += value;
                                            break;
                                    }
                                }
                            });
                        }
                    }
                });
            }

            // Átváltás órákra
            const totalHours = totalMinutes / 60;
            // Speciális kerekítés alkalmazása
            const roundedHours = roundWorklogHours(totalHours);
            
            debugLog('Összes worklog (perc):', totalMinutes);
            debugLog('Összes worklog (óra):', totalHours);
            debugLog('Kerekített worklog (óra):', roundedHours);
            
            return roundedHours;
            
        } catch (error) {
            debugLog('Hiba a worklog kinyerése során:', error);
            return '0.0';
        }
    }

    // Excel formátumú adatok készítése
    function prepareExcelData() {
        const issueData = getIssueData();
        const category = getCategory(issueData.assignee);
        const worklogHours = getTotalWorklog();
        
        // Excel számára tabulátorral elválasztott adatok + szóköz karakter a végén
        const excelData = `${issueData.key}\t${category}\t${worklogHours}\t `;
        
        debugLog('Excel adatok előkészítve:', {
            key: issueData.key,
            assignee: issueData.assignee,
            category: category,
            worklog: worklogHours
        });
        
        return {
            excelData: excelData,
            displayData: {
                key: issueData.key,
                assignee: issueData.assignee,
                category: category,
                worklog: worklogHours
            }
        };
    }

    // Gyors akció gombok hozzáadása
    function addQuickActionButtons() {
        if (!CONFIG.FEATURES.quickActions) return;

        const toolbar = document.querySelector('.aui-toolbar2-primary');
        if (!toolbar) {
            debugLog('Toolbar nem található');
            return;
        }

        // Ellenőrizzük, hogy már hozzáadtuk-e a gombokat
        if (document.querySelector('#jira-helper-actions')) {
            debugLog('Gyors akció gombok már hozzáadva');
            return;
        }

        const quickActionsDiv = document.createElement('div');
        quickActionsDiv.id = 'jira-helper-actions';
        quickActionsDiv.className = 'aui-buttons pluggable-ops';
        quickActionsDiv.style.marginLeft = '10px';

        // Issue adatok másolása gomb
        const copyDataBtn = document.createElement('button');
        copyDataBtn.className = 'aui-button';
        copyDataBtn.innerHTML = '<span class="aui-icon aui-icon-small aui-iconfont-copy"></span> Adatok másolása';
        copyDataBtn.onclick = () => {
            const issueData = getIssueData();
            const dataText = `Issue: ${issueData.key}\nCím: ${issueData.summary}\nStátusz: ${issueData.status}\nTípus: ${issueData.type}`;
            navigator.clipboard.writeText(dataText).then(() => {
                showNotification('Issue adatok vágólapra másolva!', 'success');
            });
        };

        // Excel formátumú adatok másolása gomb
        const copyExcelBtn = document.createElement('button');
        copyExcelBtn.className = 'aui-button aui-button-primary';
        copyExcelBtn.innerHTML = '<span class="aui-icon aui-icon-small aui-iconfont-spreadsheet"></span> Excel adatok';
        copyExcelBtn.onclick = () => {
            const data = prepareExcelData();
            navigator.clipboard.writeText(data.excelData).then(() => {
                const message = `Excel adatok vágólapra másolva:\n• JIRA Key: ${data.displayData.key}\n• Kategória: ${data.displayData.category}\n• Worklog: ${data.displayData.worklog} óra\n• Assignee: ${data.displayData.assignee || 'Nincs hozzárendelve'}`;
                showNotification(message, 'success');
            }).catch(err => {
                debugLog('Hiba a vágólapra másolás során:', err);
                showNotification('Hiba történt a vágólapra másolás során!', 'error');
            });
        };

        // Gyors státusz váltó gomb
        const quickStatusBtn = document.createElement('button');
        quickStatusBtn.className = 'aui-button';
        quickStatusBtn.innerHTML = '<span class="aui-icon aui-icon-small aui-iconfont-approve"></span> Gyors státusz';
        quickStatusBtn.onclick = () => {
            showQuickStatusMenu(quickStatusBtn);
        };

        quickActionsDiv.appendChild(copyDataBtn);
        quickActionsDiv.appendChild(copyExcelBtn);
        quickActionsDiv.appendChild(quickStatusBtn);
        toolbar.appendChild(quickActionsDiv);

        debugLog('Gyors akció gombok hozzáadva');
    }

    // Értesítés megjelenítése
    function showNotification(message, type = 'info') {
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 15px 20px;
            border-radius: 4px;
            color: white;
            font-weight: bold;
            z-index: 10000;
            max-width: 400px;
            white-space: pre-line;
            font-size: 12px;
            line-height: 1.4;
            ${type === 'success' ? 'background-color: #14892c;' : 
              type === 'error' ? 'background-color: #d04437;' : 
              'background-color: #205081;'}
        `;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.remove();
        }, 5000); // Hosszabb megjelenítési idő a részletes üzenetek miatt
    }

    // Gyors státusz menü
    function showQuickStatusMenu(button) {
        const menu = document.createElement('div');
        menu.style.cssText = `
            position: absolute;
            background: white;
            border: 1px solid #ccc;
            border-radius: 4px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            z-index: 1000;
            padding: 5px 0;
        `;

        const statuses = ['In Progress', 'Resolved', 'Closed', 'Reopened'];
        statuses.forEach(status => {
            const item = document.createElement('div');
            item.style.cssText = `
                padding: 8px 15px;
                cursor: pointer;
                white-space: nowrap;
            `;
            item.textContent = status;
            item.onmouseover = () => item.style.backgroundColor = '#f5f5f5';
            item.onmouseout = () => item.style.backgroundColor = 'white';
            item.onclick = () => {
                debugLog(`Státusz váltás: ${status}`);
                showNotification(`Státusz váltás: ${status}`, 'info');
                menu.remove();
            };
            menu.appendChild(item);
        });

        const rect = button.getBoundingClientRect();
        menu.style.top = (rect.bottom + window.scrollY) + 'px';
        menu.style.left = rect.left + 'px';

        document.body.appendChild(menu);

        // Kattintás máshol bezárja a menüt
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 100);
    }

    // Issue oldal továbbfejlesztések
    function enhanceIssuePage() {
        if (!CONFIG.FEATURES.issueEnhancements) return;

        // Issue kulcs kiemelése
        const issueKey = document.querySelector('#key-val');
        if (issueKey) {
            issueKey.style.cssText = `
                background-color: #f0f0f0;
                padding: 2px 6px;
                border-radius: 3px;
                font-weight: bold;
            `;
        }

        // Kritikus prioritás kiemelése
        const priority = document.querySelector('.priority img');
        if (priority && (priority.title.includes('Critical') || priority.title.includes('Blocker'))) {
            const issueHeader = document.querySelector('.issue-header-content');
            if (issueHeader) {
                issueHeader.style.borderLeft = '5px solid #d04437';
                issueHeader.style.paddingLeft = '10px';
            }
        }

        debugLog('Issue oldal továbbfejlesztve');
    }

    // Billentyű kombinációk
    function initKeyboardShortcuts() {
        if (!CONFIG.FEATURES.keyboardShortcuts) return;

        document.addEventListener('keydown', (e) => {
            // Ctrl+Shift+C: Issue adatok másolása
            if (e.ctrlKey && e.shiftKey && e.key === 'C') {
                e.preventDefault();
                const issueData = getIssueData();
                const dataText = `${issueData.key}: ${issueData.summary}`;
                navigator.clipboard.writeText(dataText).then(() => {
                    showNotification('Issue adatok másolva!', 'success');
                });
            }

            // Ctrl+Shift+E: Excel adatok másolása
            if (e.ctrlKey && e.shiftKey && e.key === 'E') {
                e.preventDefault();
                const data = prepareExcelData();
                navigator.clipboard.writeText(data.excelData).then(() => {
                    const message = `Excel adatok vágólapra másolva:\n• JIRA Key: ${data.displayData.key}\n• Kategória: ${data.displayData.category}\n• Worklog: ${data.displayData.worklog} óra`;
                    showNotification(message, 'success');
                });
            }

            // Ctrl+Shift+R: Oldal frissítése
            if (e.ctrlKey && e.shiftKey && e.key === 'R') {
                e.preventDefault();
                location.reload();
            }
        });

        debugLog('Billentyű kombinációk inicializálva');
    }

    // Automatikus frissítés
    function initAutoRefresh() {
        if (!CONFIG.FEATURES.autoRefresh) return;

        setInterval(() => {
            debugLog('Automatikus frissítés...');
            // Itt implementálható az automatikus frissítés logika
        }, CONFIG.AUTO_REFRESH_INTERVAL);
    }

    // CSS stílusok hozzáadása
    function addCustomStyles() {
        const style = document.createElement('style');
        style.textContent = `
            #jira-helper-actions .aui-button {
                margin-left: 5px;
            }
            
            .jira-helper-highlight {
                background-color: #fffbdd !important;
                border-left: 3px solid #f6c342 !important;
            }
            
            .jira-helper-critical {
                border-left: 5px solid #d04437 !important;
                background-color: #fff2f2 !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Főbb inicializálás
    function initialize() {
        debugLog('JIRA Helper Script inicializálása...');

        // CSS stílusok hozzáadása
        addCustomStyles();

        // Billentyű kombinációk
        initKeyboardShortcuts();

        // Automatikus frissítés
        initAutoRefresh();

        // Issue oldal specifikus funkciók
        if (window.location.pathname.includes('/browse/')) {
            debugLog('Issue oldal detektálva');
            
            // Várakozás az oldal betöltésére
            waitForElement('#issue-content', 5000).then(() => {
                enhanceIssuePage();
                addQuickActionButtons();
            }).catch(err => {
                debugLog('Hiba az issue oldal inicializálásakor:', err);
            });
        }

        debugLog('JIRA Helper Script inicializálva');
    }

    // Oldal betöltés után inicializálás
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // Navigáció változás figyelése (AJAX navigáció)
    let currentUrl = location.href;
    new MutationObserver(() => {
        if (location.href !== currentUrl) {
            currentUrl = location.href;
            debugLog('URL változás detektálva:', currentUrl);
            setTimeout(initialize, 1000); // Kis késleltetés az új tartalom betöltéséhez
        }
    }).observe(document, { subtree: true, childList: true });

})();

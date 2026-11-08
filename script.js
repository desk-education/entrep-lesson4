// -------------------------------------------------------------
        // CONFIGURATION OBJECTS
        // -------------------------------------------------------------
        const QUIZ_SYNC_CONFIG = {
            TEACHER_ACCESS_CODE_HASH: "51d661e8997ed17128eb6531a0a4e24a54decbae441c4ec60c16b7a0306745bc",
            // REPLACE THIS URL WITH YOUR DEPLOYED QUIZ SCORES WEB APP URL
            GOOGLE_APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyuH5psGWv2Z4BVNgJUVA1IPK-KejI-o0o8uqsj3yrYyvnQ3At3b1rNpGnkjGPF16--6Q/exec",
            COOLDOWN_MS: 5 * 60 * 1000 // 5 Minutes restriction in milliseconds
        };

        const ADMIN_CONFIG = {
            ADMIN_ACCESS_CODE_HASH: "fd74bdd901857b89f5737e5352a2a8a2d1f000aa4bed4aee47c95afaa37d0f99"
        };

        // State tracking
        let isQuizSyncing = false;
        let currentStudentDetails = { name: "", section: "" };
        let activeShuffledQuiz = [];

        // -------------------------------------------------------------
        // SHA-256 PASSCODE VERIFICATION
        // -------------------------------------------------------------
        // SHA-256 is used here to avoid storing plaintext passcodes in the page.
        // This remains client-side protection only; production authentication
        // should be verified by a secure server-side endpoint.
        async function generateSHA256Hash(passcode) {
            if (!window.crypto || !window.crypto.subtle || typeof TextEncoder === 'undefined') {
                throw new Error("Secure SHA-256 verification is unavailable. Please open this page using HTTPS or localhost and try again.");
            }

            const encoder = new TextEncoder();
            const data = encoder.encode(String(passcode));
            const hashBuffer = await window.crypto.subtle.digest("SHA-256", data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            return hashArray.map(byte => byte.toString(16).padStart(2, "0")).join("");
        }

        async function verifySHA256Passcode(passcode, expectedHash) {
            if (!passcode || !expectedHash) return false;
            const actualHash = await generateSHA256Hash(passcode);
            return actualHash === expectedHash;
        }

        // Helper to toggle password visibility
        function togglePasswordVisibility(inputId, eyeIconId) {
            const input = document.getElementById(inputId);
            const eye = document.getElementById(eyeIconId);
            if (input.type === 'password') {
                input.type = 'text';
                eye.className = "fa-solid fa-eye-slash";
            } else {
                input.type = 'password';
                eye.className = "fa-solid fa-eye";
            }
        }

        // -------------------------------------------------------------
        // QUIZ ACCESS GATE & SCORE SYNCHRONIZATION LOGIC
        // -------------------------------------------------------------
        async function unlockQuizSection() {
            const nameElement = document.getElementById('studentNameInput');
            const sectionElement = document.getElementById('studentSectionInput');
            const codeElement = document.getElementById('quizAccessCodeInput');
            const errorMsg = document.getElementById('quizGateErrorMsg');
            const requiredElements = [nameElement, sectionElement, codeElement, errorMsg];

            if (requiredElements.some(element => !element)) {
                console.error("Quiz access gate is missing one or more required HTML elements.");
                return;
            }

            const nameInput = nameElement.value.trim();
            const sectionInput = sectionElement.value.trim();
            const codeInput = codeElement.value.trim();

            if (!nameInput || !sectionInput) {
                errorMsg.innerText = "Please enter your Full Name and Grade & Section before unlocking.";
                errorMsg.classList.remove('hidden');
                return;
            }

            try {
                const isValidCode = await verifySHA256Passcode(codeInput, QUIZ_SYNC_CONFIG.TEACHER_ACCESS_CODE_HASH);
                if (!isValidCode) {
                    errorMsg.innerText = "Invalid teacher access code. Please check with your teacher.";
                    errorMsg.classList.remove('hidden');
                    return;
                }
            } catch (error) {
                console.error("Teacher access-code verification failed:", error);
                errorMsg.innerText = error.message || "Unable to verify the teacher access code. Please try again.";
                errorMsg.classList.remove('hidden');
                return;
            }

            // Code correct -> Save details and reveal quiz
            currentStudentDetails.name = nameInput;
            currentStudentDetails.section = sectionInput;

            const displayName = document.getElementById('displayStudentName');
            const displaySection = document.getElementById('displayStudentSection');
            const accessGate = document.getElementById('quizAccessGate');
            const quizContent = document.getElementById('quizMainContent');
            const relockButton = document.getElementById('relockQuizBtn');

            if (!displayName || !displaySection || !accessGate || !quizContent || !relockButton) {
                console.error("Quiz content is missing one or more required HTML elements.");
                errorMsg.innerText = "The quiz interface could not be opened because a required page element is missing. Please contact your teacher.";
                errorMsg.classList.remove('hidden');
                return;
            }

            displayName.innerText = nameInput;
            displaySection.innerText = sectionInput;

            accessGate.classList.add('hidden');
            quizContent.classList.remove('hidden');
            relockButton.classList.remove('hidden');
            errorMsg.classList.add('hidden');
        }

        function lockQuizSection() {
            document.getElementById('quizAccessCodeInput').value = "";
            document.getElementById('quizMainContent').classList.add('hidden');
            document.getElementById('relockQuizBtn').classList.add('hidden');
            document.getElementById('quizAccessGate').classList.remove('hidden');
        }

        // Check if student is within the 5-minute cooldown period
        function checkSubmissionCooldown() {
            const storageKey = `quiz_last_sub_${encodeURIComponent((currentStudentDetails.name + '_' + currentStudentDetails.section).toLowerCase())}`;
            const lastSubTime = localStorage.getItem(storageKey);
            
            if (lastSubTime) {
                const elapsed = Date.now() - parseInt(lastSubTime, 10);
                if (elapsed < QUIZ_SYNC_CONFIG.COOLDOWN_MS) {
                    const remainingMs = QUIZ_SYNC_CONFIG.COOLDOWN_MS - elapsed;
                    const remainingSec = Math.ceil(remainingMs / 1000);
                    const minutes = Math.floor(remainingSec / 60);
                    const seconds = remainingSec % 60;
                    return {
                        isRestricted: true,
                        remainingFormatted: `${minutes}m ${seconds}s`,
                        remainingMs: remainingMs
                    };
                }
            }
            return { isRestricted: false };
        }

        function setSubmissionCooldown() {
            const storageKey = `quiz_last_sub_${encodeURIComponent((currentStudentDetails.name + '_' + currentStudentDetails.section).toLowerCase())}`;
            localStorage.setItem(storageKey, Date.now().toString());
        }

        async function sendQuizScoresToGoogleSheets(score, totalQuestions, percentage) {
            const syncBox = document.getElementById('quizSyncStatusMessage');
            syncBox.classList.remove('hidden', 'bg-emerald-50', 'text-emerald-900', 'border-emerald-300', 'bg-rose-50', 'text-rose-900', 'border-rose-300', 'bg-blue-50', 'text-blue-900', 'border-blue-300');
            syncBox.className = "p-3 rounded-xl text-xs font-medium leading-relaxed bg-blue-50 text-blue-900 border border-blue-300 block";
            syncBox.innerHTML = `<i class="fa-solid fa-spinner animate-spin"></i> Synchronizing quiz score to teacher database...`;

            const formData = new URLSearchParams();
            formData.append('studentName', currentStudentDetails.name);
            formData.append('section', currentStudentDetails.section);
            formData.append('score', score);
            formData.append('totalQuestions', totalQuestions);
            formData.append('percentage', percentage);

            try {
                const response = await fetch(QUIZ_SYNC_CONFIG.GOOGLE_APPS_SCRIPT_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: formData.toString()
                });

                if (response.ok) {
                    const res = await response.json();
                    if (res.success) {
                        setSubmissionCooldown();
                        syncBox.className = "p-3 rounded-xl text-xs font-medium leading-relaxed bg-emerald-50 text-emerald-900 border border-emerald-300 block";
                        syncBox.innerHTML = `<i class="fa-solid fa-circle-check text-emerald-600"></i> <strong>Score Synchronized!</strong> Your result (${score}/${totalQuestions}) has been submitted to the teacher's gradebook.`;
                    } else if (res.rateLimited) {
                        syncBox.className = "p-3 rounded-xl text-xs font-medium leading-relaxed bg-rose-50 text-rose-900 border border-rose-300 block";
                        syncBox.innerHTML = `<i class="fa-solid fa-clock"></i> <strong>Multiple Submission Restriction:</strong> ${escapeHtml(res.message)}`;
                    } else {
                        syncBox.className = "p-3 rounded-xl text-xs font-medium leading-relaxed bg-amber-50 text-amber-900 border border-amber-300 block";
                        syncBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Server Response: ${escapeHtml(res.message)}`;
                    }
                } else {
                    throw new Error("Sync request status: " + response.status);
                }
            } catch (err) {
                if (QUIZ_SYNC_CONFIG.GOOGLE_APPS_SCRIPT_URL.includes("SAMPLE_QUIZ_SYNC_ENDPOINT_URL")) {
                    setSubmissionCooldown();
                    syncBox.className = "p-3 rounded-xl text-xs font-medium leading-relaxed bg-blue-50 text-blue-900 border border-blue-300 block";
                    syncBox.innerHTML = `<i class="fa-solid fa-circle-info"></i> <strong>Graded Locally:</strong> Score computed! To log scores to live Google Sheets, paste your deployed Apps Script URL in <code>QUIZ_SYNC_CONFIG.GOOGLE_APPS_SCRIPT_URL</code>.`;
                } else {
                    syncBox.className = "p-3 rounded-xl text-xs font-medium leading-relaxed bg-rose-50 text-rose-900 border border-rose-300 block";
                    syncBox.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Sync Error: Score graded on page. Detailed log: ${escapeHtml(err.message)}`;
                }
            }
        }

        // -------------------------------------------------------------
        // ADMIN GUIDE SECTION LOCK / UNLOCK LOGIC (SHA-256 verification)
        // -------------------------------------------------------------
        async function unlockAdminGuideSection() {
            const inputElement = document.getElementById('adminAccessCodeInput');
            const errorMsg = document.getElementById('adminGateErrorMsg');
            const accessGate = document.getElementById('adminAccessGate');
            const adminGuide = document.getElementById('admin-guide-section');

            if (!inputElement || !errorMsg || !accessGate || !adminGuide) {
                console.error("Administrator access gate is missing one or more required HTML elements.");
                return;
            }

            const inputCode = inputElement.value.trim();

            try {
                const isValidCode = await verifySHA256Passcode(inputCode, ADMIN_CONFIG.ADMIN_ACCESS_CODE_HASH);
                if (isValidCode) {
                    accessGate.classList.add('hidden');
                    adminGuide.classList.remove('hidden');
                    errorMsg.classList.add('hidden');
                } else {
                    errorMsg.innerText = "Invalid administrator access code.";
                    errorMsg.classList.remove('hidden');
                }
            } catch (error) {
                console.error("Administrator access-code verification failed:", error);
                errorMsg.innerText = error.message || "Unable to verify the administrator access code. Please try again.";
                errorMsg.classList.remove('hidden');
            }
        }

        function lockAdminGuideSection() {
            document.getElementById('adminAccessCodeInput').value = "";
            document.getElementById('admin-guide-section').classList.add('hidden');
            document.getElementById('adminAccessGate').classList.remove('hidden');
        }

        // -------------------------------------------------------------
        // HTML escaping helper used by assessment feedback and synchronization messages.
        function escapeHtml(str) {
            return String(str)
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;");
        }

        // -------------------------------------------------------------
        // 1. DATA: 5-STAGE LEARNING FLOW DATA
        // -------------------------------------------------------------
        const flowData = {
            1: {
                stage: "Stage 1: Opportunity Identification",
                icon: "fa-magnifying-glass",
                color: "text-blue-600",
                badgeBg: "bg-blue-100",
                summary: "Discovering unfulfilled consumer pain points and identifying viable product or service concepts.",
                details: [
                    "Conduct local community and campus surveys to identify unmet needs.",
                    "Evaluate potential target market demographics and purchasing habits.",
                    "Define the unique value proposition that distinguishes the idea from competitors."
                ],
                keyUnderstanding: "A business does not start with an isolated idea; it starts by understanding real customer needs."
            },
            2: {
                stage: "Stage 2: Business Planning",
                icon: "fa-pen-ruler",
                color: "text-emerald-600",
                badgeBg: "bg-emerald-100",
                summary: "Structuring operations, financial budgets, and resource allocation before spending capital.",
                details: [
                    "Formulate product/service specifications and operational workflows.",
                    "Establish clear starting capital requirements and overhead projections.",
                    "Set risk mitigation strategies and inventory procurement plans."
                ],
                keyUnderstanding: "Careful planning reduces financial risk and provides a clear operational roadmap."
            },
            3: {
                stage: "Stage 3: Implementation",
                icon: "fa-gears",
                color: "text-amber-600",
                badgeBg: "bg-amber-100",
                summary: "Translating written plans into active daily business execution and service delivery.",
                details: [
                    "Procure raw materials and execute standardized production procedures.",
                    "Manage daily store operations, customer interactions, and quality assurance.",
                    "Maintain teamwork, delegation, and operational consistency."
                ],
                keyUnderstanding: "Success requires transforming strategy into efficient, hands-on daily operations."
            },
            4: {
                stage: "Stage 4: Marketing Strategy",
                icon: "fa-bullhorn",
                color: "text-purple-600",
                badgeBg: "bg-purple-100",
                summary: "Communicating value, promoting products, and building customer relationship channels.",
                details: [
                    "Design creative promotional campaigns, slogans, and visual displays.",
                    "Utilize social media channels and campus group chats for targeted outreach.",
                    "Apply honest pricing structures and customer retention loyalty incentives."
                ],
                keyUnderstanding: "Effective marketing connects product benefits directly to target buyers ethically."
            },
            5: {
                stage: "Stage 5: Financial Evaluation & Improvement",
                icon: "fa-chart-line",
                color: "text-rose-600",
                badgeBg: "bg-rose-100",
                summary: "Analyzing sales ledgers, calculating profitability, and refining business processes.",
                details: [
                    "Perform net profit, gross margin, and cash flow ledger audits.",
                    "Gather customer feedback to pinpoint areas for product quality refinement.",
                    "Determine whether to scale operations or adjust business models."
                ],
                keyUnderstanding: "Continuous evaluation ensures business sustainability and long-term financial health."
            }
        };

        function switchFlowStep(stepNumber) {
            for (let i = 1; i <= 5; i++) {
                const btn = document.getElementById(`flow-btn-${i}`);
                if (i === stepNumber) {
                    btn.classList.add('active', 'border-blue-500', 'bg-blue-50');
                    btn.classList.remove('border-slate-200');
                } else {
                    btn.classList.remove('active', 'border-blue-500', 'bg-blue-50');
                    btn.classList.add('border-slate-200');
                }
            }

            const data = flowData[stepNumber];
            const cardContainer = document.getElementById('flow-content-card');
            cardContainer.innerHTML = `
                <div class="flex items-center space-x-3 mb-4">
                    <div class="w-10 h-10 rounded-xl ${data.badgeBg} ${data.color} flex items-center justify-center text-xl font-bold">
                        <i class="fa-solid ${data.icon}"></i>
                    </div>
                    <div>
                        <h4 class="text-xl font-bold text-slate-900">${data.stage}</h4>
                        <p class="text-xs text-slate-500">${data.summary}</p>
                    </div>
                </div>
                
                <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                    <div class="bg-white p-4 rounded-xl border border-slate-200">
                        <h5 class="font-bold text-xs uppercase text-slate-400 mb-2">Key Action Items</h5>
                        <ul class="space-y-2 text-xs text-slate-700">
                            ${data.details.map(detail => `<li class="flex items-start gap-2"><i class="fa-solid fa-circle-check text-emerald-500 mt-0.5"></i> <span>${detail}</span></li>`).join('')}
                        </ul>
                    </div>
                    <div class="bg-blue-900 text-white p-4 rounded-xl flex flex-col justify-between">
                        <div>
                            <span class="text-[10px] uppercase font-bold text-deped-gold">Core Learning Takeaway</span>
                            <p class="text-xs sm:text-sm text-blue-100 italic mt-2">"${data.keyUnderstanding}"</p>
                        </div>
                        <div class="mt-4 pt-2 border-t border-blue-800 text-[11px] text-blue-300 flex items-center justify-between">
                            <span>Step ${stepNumber} of 5</span>
                            <i class="fa-solid fa-arrow-right"></i>
                        </div>
                    </div>
                </div>
            `;
        }

        // -------------------------------------------------------------
        // 2. GROUP TAB SWITCHING & WORKSTATION LOGIC
        // -------------------------------------------------------------
        function switchGroupTab(tabNum) {
            for (let i = 1; i <= 4; i++) {
                const tab = document.getElementById(`group-tab-${i}`);
                const panel = document.getElementById(`group-panel-${i}`);
                if (i === tabNum) {
                    tab.className = "px-5 py-2.5 rounded-xl font-bold text-sm transition bg-deped-blue text-white shadow-md flex items-center gap-2";
                    panel.classList.remove('hidden');
                } else {
                    tab.className = "px-5 py-2.5 rounded-xl font-bold text-sm transition bg-white text-slate-600 hover:bg-slate-100 flex items-center gap-2";
                    panel.classList.add('hidden');
                }
            }
        }

        // Group 1 Flow Scenario Tester
        function testFlowScenario(type) {
            const output = document.getElementById('scenario-output');
            output.classList.remove('hidden');
            if (type === 'ingredient_spike') {
                output.innerHTML = `<strong>⚠️ Scenario Result:</strong> Banana costs increase by 20%. Flow Adjustment: Adjust unit price from ₱15 to ₱16 or re-negotiate bulk pricing with suppliers during <em>Phase 2 Planning</em> to preserve ₱250 profit.`;
            } else {
                output.innerHTML = `<strong>⚠️ Scenario Result:</strong> Recess rain cuts foot traffic. Flow Adjustment: Shift focus to <em>Phase 4 Marketing</em> room-to-room pre-orders during morning advisory hour.`;
            }
        }

        // Group 2 Interactive Task Cards
        const completedCards = new Set();
        function toggleTaskCard(cardNum) {
            const card = document.getElementById(`task-card-${cardNum}`);
            const icon = document.getElementById(`task-icon-${cardNum}`);
            
            if (completedCards.has(cardNum)) {
                completedCards.delete(cardNum);
                card.classList.remove('bg-emerald-100', 'border-emerald-500');
                icon.className = "fa-regular fa-circle text-slate-400 text-lg";
            } else {
                completedCards.add(cardNum);
                card.classList.add('bg-emerald-100', 'border-emerald-500');
                icon.className = "fa-solid fa-circle-check text-emerald-600 text-lg";
            }

            const progress = (completedCards.size / 4) * 100;
            document.getElementById('ops-progress').style.width = `${progress}%`;
        }

        // Group 3 Cooperation Logger
        function logCooperationEntry() {
            const input = document.getElementById('coop-log-input');
            const list = document.getElementById('coop-log-list');
            if (input.value.trim() === '') return;

            const entry = document.createElement('div');
            entry.className = "p-2 bg-white rounded border border-amber-200 text-xs text-slate-800";
            entry.innerHTML = `<span class="font-bold text-amber-700">Logged:</span> "${escapeHtml(input.value.trim())}"`;
            list.prepend(entry);
            input.value = '';
        }

        // Group 4 Ethical Calculator
        function calculateEthicalPrice() {
            const ingredients = parseFloat(document.getElementById('cost-ingredients').value) || 0;
            const labor = parseFloat(document.getElementById('cost-labor').value) || 0;
            const marginPercent = parseFloat(document.getElementById('profit-margin').value) || 0;

            const baseCost = ingredients + labor;
            const price = baseCost * (1 + marginPercent / 100);

            document.getElementById('calculated-price').innerText = `₱${price.toFixed(2)}`;
        }

        // -------------------------------------------------------------
        // 3. 15-ITEM ALIGNED ASSESSMENT QUIZ DATA & LOGIC (WITH RANDOMIZATION)
        // -------------------------------------------------------------
        const masterQuizQuestions = [
            {
                id: 1,
                question: "What is the initial phase of the Interactive Entrepreneurship Learning Flow?",
                options: [
                    "Conducting product marketing campaigns",
                    "Identifying business opportunities and customer needs",
                    "Preparing final financial balance sheets",
                    "Purchasing commercial heavy equipment"
                ],
                correct: 1
            },
            {
                id: 2,
                question: "Which behavior best demonstrates cooperation during a collaborative entrepreneurship activity?",
                options: [
                    "Sharing workload and integrating diverse group perspectives",
                    "Working in isolation to finish faster",
                    "Overriding team decisions without discussion",
                    "Assigning all tasks to a single group member"
                ],
                correct: 0
            },
            {
                id: 3,
                question: "An entrepreneur records all cash inflows and outflows accurately without hiding deficits. Which core value is reflected here?",
                options: [
                    "Speed",
                    "Ambition",
                    "Honesty",
                    "Competitiveness"
                ],
                correct: 2
            },
            {
                id: 4,
                question: "What is the primary purpose of creating a structured business plan prior to launching operations?",
                options: [
                    "To eliminate all future financial investments",
                    "To avoid communicating with potential target clients",
                    "To guarantee immediate market monopoly",
                    "Guiding execution and mitigating operational risks"
                ],
                correct: 3
            },
            {
                id: 5,
                question: "Which action belongs directly to the marketing component of the business flow?",
                options: [
                    "Conducting monthly tax audits",
                    "Calculating raw material depreciation",
                    "Promoting product value to target customers",
                    "Setting up internal organizational hierarchies"
                ],
                correct: 2
            },
            {
                id: 6,
                question: "Which metric is primarily analyzed during the financial evaluation stage of a business?",
                options: [
                    "Profitability and expense balances",
                    "Total social media followers",
                    "Classroom attendance logs",
                    "Employee physical fitness levels"
                ],
                correct: 0
            },
            {
                id: 7,
                question: "What does the implementation stage of the entrepreneurship learning flow involve?",
                options: [
                    "Abandoning business ideas after brainstorming",
                    "Executing planned daily business operations",
                    "Writing legal charters before market research",
                    "Pausing all commercial communications"
                ],
                correct: 1
            },
            {
                id: 8,
                question: "Which scenario demonstrates student responsibility during a group business venture?",
                options: [
                    "Fulfilling assigned tasks promptly and thoroughly",
                    "Blaming teammates when deadline challenges arise",
                    "Skipping team planning sessions repeatedly",
                    "Modifying group goals without consultation"
                ],
                correct: 0
            },
            {
                id: 9,
                question: "Why is identifying customer pain points essential during initial market research?",
                options: [
                    "It guarantees zero competition in the local area",
                    "It replaces the need for financial accounting",
                    "It ensures products solve real consumer problems",
                    "It lowers raw material supply prices automatically"
                ],
                correct: 2
            },
            {
                id: 10,
                question: "What is the pedagogical goal of using dyadic interaction (paired sharing) in learning entrepreneurship?",
                options: [
                    "Testing memorization of complex accounting formulas",
                    "Rating individual public speaking abilities formally",
                    "Restricting collaborative group work dynamics",
                    "Encouraging active peer reflection and discussion"
                ],
                correct: 3
            },
            {
                id: 11,
                question: "What should an entrepreneur do after discovering negative customer feedback during evaluation?",
                options: [
                    "Ignore customer comments to save time",
                    "Refine product quality based on feedback",
                    "Stop selling all items permanently",
                    "Increase prices immediately to offset losses"
                ],
                correct: 1
            },
            {
                id: 12,
                question: "Which practice reflects honesty when setting retail prices for consumer goods?",
                options: [
                    "Displaying clear and transparent product pricing",
                    "Charging hidden surcharges without disclosure",
                    "Artificially inflating costs during high demand",
                    "Misrepresenting low-quality goods as premium brands"
                ],
                correct: 0
            },
            {
                id: 13,
                question: "How can a micro-enterprise optimize limited starting capital effectively?",
                options: [
                    "Spending budget on non-essential decorative items",
                    "Delaying product production indefinitely",
                    "Prioritizing essential operational expenses strictly",
                    "Distributing capital equally as personal profit"
                ],
                correct: 2
            },
            {
                id: 14,
                question: "Which sequence reflects the correct order of the Interactive Entrepreneurship Learning Flow?",
                options: [
                    "Evaluation → Implementation → Planning → Marketing",
                    "Opportunity Identification → Planning → Implementation → Evaluation",
                    "Marketing → Evaluation → Planning → Opportunity Identification",
                    "Implementation → Opportunity Identification → Evaluation → Planning"
                ],
                correct: 1
            },
            {
                id: 15,
                question: "What defines a sustainable and meaningful business venture over time?",
                options: [
                    "Focusing solely on short-term high profits",
                    "Operating without customer feedback mechanisms",
                    "Minimizing product quality to reduce expenditure",
                    "Balancing customer value, financial stability, and ethical practices"
                ],
                correct: 3
            }
        ];

        const userAnswers = {};

        // Fisher-Yates Randomization Shuffle
        function shuffleArray(array) {
            const arr = [...array];
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
            return arr;
        }

        function renderQuiz() {
            // Shuffle questions every time quiz renders or reloads
            activeShuffledQuiz = shuffleArray(masterQuizQuestions);
            
            const container = document.getElementById('quiz-container');
            container.innerHTML = activeShuffledQuiz.map((q, index) => `
                <div id="question-card-${q.id}" class="bg-slate-50 p-5 sm:p-6 rounded-2xl border border-slate-200 space-y-4 transition">
                    <div class="flex items-start justify-between gap-3">
                        <h4 class="font-bold text-sm sm:text-base text-slate-800">
                            <span class="text-deped-blue font-extrabold mr-1">Q${index + 1}.</span> ${q.question}
                        </h4>
                        <span id="badge-${q.id}" class="hidden text-xs font-bold px-2.5 py-0.5 rounded-full"></span>
                    </div>

                    <div class="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                        ${q.options.map((opt, optIdx) => `
                            <button onclick="selectAnswer(${q.id}, ${optIdx})" id="opt-${q.id}-${optIdx}" 
                                class="quiz-option text-left p-3 text-xs sm:text-sm rounded-xl border border-slate-200 bg-white hover:border-blue-400 hover:bg-blue-50/50 transition flex items-center gap-3">
                                <span class="w-6 h-6 rounded-full border border-slate-300 flex items-center justify-center font-bold text-xs text-slate-500 bg-slate-50 flex-shrink-0">
                                    ${String.fromCharCode(65 + optIdx)}
                                </span>
                                <span class="text-slate-700 font-medium">${opt}</span>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        }

        function selectAnswer(questionId, optionIndex) {
            userAnswers[questionId] = optionIndex;
            
            // Remove error highlight on selection
            const card = document.getElementById(`question-card-${questionId}`);
            if (card) {
                card.classList.remove('border-rose-400', 'bg-rose-50/30');
            }

            // Hide validation alert if answered all
            const answeredCount = Object.keys(userAnswers).length;
            if (answeredCount === masterQuizQuestions.length) {
                document.getElementById('quizValidationWarning').classList.add('hidden');
            }

            const q = masterQuizQuestions.find(item => item.id === questionId);
            q.options.forEach((_, idx) => {
                const btn = document.getElementById(`opt-${questionId}-${idx}`);
                if (idx === optionIndex) {
                    btn.className = "quiz-option text-left p-3 text-xs sm:text-sm rounded-xl border-2 border-deped-blue bg-blue-50 transition flex items-center gap-3 font-semibold text-deped-blue";
                } else {
                    btn.className = "quiz-option text-left p-3 text-xs sm:text-sm rounded-xl border border-slate-200 bg-white hover:border-blue-400 transition flex items-center gap-3 opacity-70";
                }
            });

            const progressPercent = (answeredCount / masterQuizQuestions.length) * 100;
            document.getElementById('quiz-progress').style.width = `${progressPercent}%`;
        }

        function submitQuiz() {
            const warningBox = document.getElementById('quizValidationWarning');
            warningBox.classList.add('hidden');

            // 1. FEATURE: MANDATORY COMPLETION CHECK
            const unansweredList = [];
            activeShuffledQuiz.forEach((q, index) => {
                if (userAnswers[q.id] === undefined) {
                    unansweredList.push({ questionId: q.id, displayNum: index + 1 });
                    const card = document.getElementById(`question-card-${q.id}`);
                    if (card) {
                        card.classList.add('border-rose-400', 'bg-rose-50/30');
                    }
                }
            });

            if (unansweredList.length > 0) {
                const missingNums = unansweredList.map(u => `Q${u.displayNum}`).join(', ');
                warningBox.className = "p-4 rounded-2xl bg-rose-50 border border-rose-300 text-rose-900 text-xs leading-relaxed space-y-1 block";
                warningBox.innerHTML = `
                    <div class="flex items-center gap-2 font-bold text-rose-700 text-sm">
                        <i class="fa-solid fa-triangle-exclamation"></i> Incomplete Assessment!
                    </div>
                    <p>You must answer all 15 questions before submitting. Missing items: <strong>${missingNums}</strong>.</p>
                `;

                // Auto-scroll to the first unanswered item
                const firstUnansweredCard = document.getElementById(`question-card-${unansweredList[0].questionId}`);
                if (firstUnansweredCard) {
                    firstUnansweredCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }
                return;
            }

            // 2. FEATURE: 5-MINUTE COOLDOWN CHECK BEFORE SUBMITTING TO GOOGLE SHEETS
            const cooldown = checkSubmissionCooldown();
            if (cooldown.isRestricted) {
                warningBox.className = "p-4 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs leading-relaxed block";
                warningBox.innerHTML = `
                    <div class="flex items-center gap-2 font-bold text-amber-800 text-sm">
                        <i class="fa-solid fa-stopwatch"></i> Multiple Submission Cooldown Active
                    </div>
                    <p class="mt-1">
                        To prevent spamming the teacher's gradebook, student <strong>${escapeHtml(currentStudentDetails.name)}</strong> can only submit once every 5 minutes. 
                        Please try again in <strong class="text-amber-900 font-mono">${cooldown.remainingFormatted}</strong>.
                    </p>
                `;
                warningBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
                return;
            }

            // 3. GRADE QUIZ WITHOUT REVEALING CORRECT ANSWERS
            let score = 0;

            activeShuffledQuiz.forEach(q => {
                const selected = userAnswers[q.id];
                const badge = document.getElementById(`badge-${q.id}`);

                q.options.forEach((_, idx) => {
                    const btn = document.getElementById(`opt-${q.id}-${idx}`);
                    btn.disabled = true;

                    if (idx === selected) {
                        if (selected === q.correct) {
                            btn.className = "quiz-option text-left p-3 text-xs sm:text-sm rounded-xl border-2 border-emerald-500 bg-emerald-50 text-emerald-900 font-bold flex items-center gap-3";
                        } else {
                            btn.className = "quiz-option text-left p-3 text-xs sm:text-sm rounded-xl border-2 border-rose-500 bg-rose-50 text-rose-900 font-medium flex items-center gap-3";
                        }
                    } else {
                        btn.className = "quiz-option text-left p-3 text-xs sm:text-sm rounded-xl border border-slate-200 bg-white opacity-50 flex items-center gap-3";
                    }
                });

                if (selected === q.correct) {
                    score++;
                    badge.innerText = "Correct";
                    badge.className = "text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 border border-emerald-300 block";
                } else {
                    // Marked wrong ONLY - does NOT reveal the correct option
                    badge.innerText = "Incorrect";
                    badge.className = "text-xs font-bold px-2.5 py-0.5 rounded-full bg-rose-100 text-rose-700 border border-rose-300 block";
                }
            });

            document.getElementById('score-display').innerText = `${score} / 15`;

            const percentage = ((score / 15) * 100).toFixed(1);

            // Trigger score sync with Google Apps Script backend
            sendQuizScoresToGoogleSheets(score, 15, percentage);

            if (score >= 10 && typeof confetti === 'function') {
                confetti({
                    particleCount: 100,
                    spread: 70,
                    origin: { y: 0.6 }
                });
            }
        }

        function resetQuiz() {
            for (let id in userAnswers) delete userAnswers[id];
            document.getElementById('score-display').innerText = `0 / 15`;
            document.getElementById('quiz-progress').style.width = `0%`;
            document.getElementById('quizValidationWarning').classList.add('hidden');
            const syncBox = document.getElementById('quizSyncStatusMessage');
            if (syncBox) syncBox.className = "hidden p-3 rounded-xl text-xs font-medium leading-relaxed";
            renderQuiz();
        }

        // -------------------------------------------------------------
        // INITIALIZATION ON PAGE LOAD
        // -------------------------------------------------------------
        window.onload = function() {
            switchFlowStep(1);
            renderQuiz(); // Shuffles questions automatically on load
        };

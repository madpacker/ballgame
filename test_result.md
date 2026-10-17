#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Bug: Setiap kali main quiz, hasil akhir selalu tampil "9 benar / 10" dan skor stuck di 900,
  padahal pemain menjawab semua pertanyaan dengan benar. Juga skor tidak bertambah di game berikutnya.

  Fitur baru yang baru dibangun:
  1. Admin bisa mengubah background game (upload gambar global untuk semua user; tampil di Home & Quiz).
  2. Halaman "Berita Update" (list + detail) — admin bisa posting berita dengan judul, cover image, body;
     user bisa melihat list dan detail dengan pull-to-refresh.
  3. Deskripsi + media sosial admin (Instagram, TikTok, WhatsApp, YouTube) yang bisa diedit lewat
     dashboard admin; tombol link dapat dibuka di Profil & halaman Berita.

backend:
  - task: "App Settings endpoints (background + socials + description)"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added GET /api/app-settings (public), PUT /api/admin/app-settings (JSON body with
          description + socials), POST /api/admin/app-settings/background (multipart `image`
          upload via Emergent Object Storage), DELETE /api/admin/app-settings/background.
          Admin auth is required for write endpoints. Settings persist in `app_settings`
          collection under `_key: "public"`.
  - task: "News CRUD endpoints"
    implemented: true
    working: "NA"
    file: "backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added GET /api/news (public list), GET /api/news/{id} (public detail),
          POST /api/admin/news (multipart title/body/cover) with cover upload to Emergent
          Object Storage, PUT /api/admin/news/{id}, DELETE /api/admin/news/{id} (soft
          delete). Server auto-generates `excerpt` from body (first 160 chars).

frontend:
  - task: "Fix quiz scoring bug: stale state in finish()"
    implemented: true
    working: "NA"
    file: "frontend/app/quiz.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          User reported: after answering all 10 classic questions correctly, result screen
          always shows "9 benar / 10" and score stuck at 900; next game shows the same.
          Root cause: `choose()` scheduled `setScore`/`setCorrectCount` and then called
          `finish()` 900ms later via setTimeout. The setTimeout captured the OLD `finish`
          closure (with stale `score`/`correctCount` from the render BEFORE the last
          answer). Fix: compute `nextScore`/`nextCorrect` synchronously inside `choose`,
          pass them to `finish(finalScore, finalCorrect)` as explicit args; also keep
          `scoreRef`/`correctRef`/`indexRef` mirrors so the Time Attack timer callback
          also reads the latest numbers.
  - task: "News list & detail screens"
    implemented: true
    working: "NA"
    file: "frontend/app/news/index.tsx, frontend/app/news/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          New `/news` route (FlatList + RefreshControl) with embedded admin "About" card
          showing description + social buttons (IG / TikTok / WhatsApp / YouTube) that
          open via Linking.openURL. `/news/[id]` renders cover image, title, author meta,
          body, and native Share button. Added "Berita" shortcut on Home.
  - task: "Admin dashboard: background + socials + news management"
    implemented: true
    working: "NA"
    file: "frontend/app/admin.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added three new form cards: (1) Background upload (16:9 picker + upload + reset);
          (2) Info & Socials (description + IG/TikTok/WhatsApp/YouTube text inputs + Save);
          (3) News composer (cover picker + title + body + publish) and inline news list
          with view/delete.
  - task: "Home & Quiz use admin-set background"
    implemented: true
    working: "NA"
    file: "frontend/app/index.tsx, frontend/app/quiz.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Both Home hero image and the quiz background now use `absoluteFileUrl(settings.background_url)`
          from `useAppSettings`; falls back to the stock stadium image when admin has not
          uploaded a custom background.
  - task: "Profile shows admin social links"
    implemented: true
    working: "NA"
    file: "frontend/app/profile.tsx"
    stuck_count: 0
    priority: "medium"
    needs_retesting: true
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Added "Berita Update" link and an "IKUTI ADMIN" card with social buttons that
          open the matching platform URL via expo-linking.

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 9
  run_ui: false

test_plan:
  current_focus:
    - "Fix quiz scoring bug: stale state in finish()"
    - "App Settings endpoints (background + socials + description)"
    - "News CRUD endpoints"
    - "Admin dashboard: background + socials + news management"
    - "News list & detail screens"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Please test (1) the quiz scoring bug fix end-to-end: play Classic mode via the UI,
      answer all 10 questions correctly, and verify the result screen reports 10/10 and
      1000 points, and that a second game accumulates its own fresh total.
      (2) Test the new backend endpoints end-to-end: GET /api/app-settings (unauthed) ->
      ok; PUT /api/admin/app-settings as admin -> socials + description persist; multipart
      POST /api/admin/app-settings/background -> background_url returned & GET reflects it;
      DELETE background -> cleared. News: POST /api/admin/news (multipart with cover) ->
      returned doc has cover_url; GET /api/news lists it, GET /api/news/{id} returns full
      body; DELETE soft-deletes it (list no longer contains it). Admin auth enforcement:
      calling admin endpoints without a session or without is_admin should return 401/403.
      Also please smoke-test the frontend screens: /news list + detail, /profile social
      links, /admin new form cards.
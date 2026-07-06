# Prosepect Features

This document outlines the core features for the Prosepect web application.

- **Push to GitHub → Publish**: Authors write essays or chapters in Markdown/MDX, push to a repository, and it instantly renders as a clean post.
  - *Requirements:* GitHub App/OAuth integration for webhooks, MDX parsing engine, database mapping, hosting for frontend rendering.
- **Edits with PR**: Readers submit standard Pull Requests directly to the article's source file to fix typos, update code, or clear up confusion.
  - *Requirements:* GitHub API integration for creating branches and PRs, inline editing UI, GitHub OAuth for readers.
- **Version Branching**: Readers can toggle between Git branches (like next-14 vs next-15) to see how the article's text and code examples change based on framework versions.
  - *Requirements:* Git integration to track branches, UI state management for version toggling, dynamic routing for branches.
- **Contributor Rewards**: Automatically showcase and credit readers at the top of the article as active contributors once their fix/PR is merged by the author.
  - *Requirements:* Webhooks to detect merged PRs, database for tracking contributions, UI component for avatars.
- **Runnable Code Snippets**: Live, executable code environments embedded directly in the prose so readers can tweak parameters inline without leaving the page.
  - *Requirements:* In-browser runtime (e.g., WebContainers, Sandpack, or Pyodide), custom interactive MDX components.
- **AI Chapter Tester**: A quick, lightweight AI checkpoint at the end of an article that tests the reader's comprehension or prompts them to write a fast code solution based on what they just read.
  - *Requirements:* LLM API integration, dynamic prompt generation based on article content, interactive quiz/assessment UI.
- **One-Click Code Forking**: Let readers fork the article's companion repository to their personal GitHub account with a single click to save their custom code snippet solutions.
  - *Requirements:* GitHub OAuth (`repo` scope), GitHub API integration for forking repositories.
- **Multiplayer Reading Rooms**: Shared spaces where communities can read deep-dives together, discuss paragraphs in real time, and share broken code logs for collective debugging.
  - *Requirements:* WebSockets for real-time communication, presence system, anchored live chat UI.
- **Progressive Account Linking (User Profile)**: Users can sign up quickly via Google or Email. In their Profile Settings, they see a "Connections" section showing linked accounts. If they attempt a Git-centric action (like PRs or Forking) without a GitHub account connected, they are prompted to link it there.
  - *Requirements:* Database schema supporting multiple `Account` providers per `User`, OAuth provider configuration (Google, GitHub, Email), Settings UI for displaying and managing connected providers.

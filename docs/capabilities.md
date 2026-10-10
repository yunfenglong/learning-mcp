# Read and beta write capability reference

Generated from `src/capabilities/` by `pnpm capabilities:docs`. Do not edit this table by hand. Runtime/deployment management is excluded; connection and course binding controls remain in the account service.

Arguments marked * are required. Defaults, validation bounds and full descriptions are available from MCP `tools/list`. Course content uses a user-confirmed course key or unambiguous code; platform IDs and arbitrary URLs cannot replace the binding.

## Suite

| Tool | Backend operation | Arguments |
| --- | --- | --- |
| `course_units` | Suite workflow | None |
| `find_attendance_code` | Suite workflow | `unit`*, `date`*, `session_type`, `group` |
| `capability_catalog` | Suite workflow | None |

## ed

| Tool | Backend operation | Arguments |
| --- | --- | --- |
| `ed_user` | `get_user` | None |
| `ed_courses` | `courses` | `limit` = 100, `offset` = 0, `include_archived` = false |
| `ed_lessons` | `list_lessons` | `unit`*, `module`, `lesson_type`, `state`, `status` |
| `ed_lesson` | `get_lesson` | `unit`*, `lesson_id`* |
| `ed_threads` | `list_threads` | `unit`*, `limit` = 100, `offset` = 0, `since`, `sort` = "new", `answered`, `category`, `subcategory`, `thread_type` |
| `ed_thread` | `get_thread` | `unit`*, `thread_id`*, `include_html` = true |
| `ed_course` | `course` | `unit`* |
| `ed_search_threads` | `search_threads` | `unit`*, `query`*, `limit` = 100, `offset` = 0, `since`, `sort` = "new", `answered`, `category`, `subcategory`, `thread_type` |
| `ed_course_thread` | `get_course_thread` | `unit`*, `number`*, `include_html` = true |
| `ed_activity` | `list_activity` | `unit`, `filter_type` = "all", `limit` = 30, `offset` = 0 |
| `ed_modules` | `list_modules` | `unit`* |
| `ed_lesson_files` | `list_lesson_files` | `unit`*, `lesson_id`*, `slide_id` |
| `ed_thread_files` | `list_thread_files` | `unit`*, `thread_id`* |
| `ed_file` | `file` | `unit`*, `lesson_id`, `thread_id`, `slide_id`, `file_index` = 0 |
| `ed_download` | `download` | `unit`*, `lesson_id`, `thread_id`, `slide_id`, `limit` = 20, `offset` = 0 |
| `ed_read_thread` | `read_thread` | `unit`*, `thread_id`, `number` |
| `ed_read_lesson` | `read_lesson` | `unit`*, `lesson_id`* |
| `ed_show_forum_catchup` | `show_forum_catchup` | `unit`*, `days` = 14 |
| `ed_show_thread_activity` | `show_thread_activity` | `unit`*, `weeks` = 12 |
| `ed_show_lesson_progress` | `show_lesson_progress` | `unit`* |
| `ed_show_lesson_guide` | `show_lesson_guide` | `unit`*, `lesson_id`*, `sections`*, `quiz` = [] |
| `ed_slide` | `get_slide` | `unit`*, `lesson_id`*, `slide_id`* |
| `ed_read_slide` | `read_slide` | `unit`*, `lesson_id`*, `slide_id`* |
| `ed_slide_questions` | `list_slide_questions` | `unit`*, `lesson_id`*, `slide_id`* |
| `ed_slide_responses` | `list_slide_responses` | `unit`*, `lesson_id`*, `slide_id`* |

## moodle

| Tool | Backend operation | Arguments |
| --- | --- | --- |
| `moodle_user` | `get_user` | None |
| `moodle_courses` | `courses` | `limit` = 100, `offset` = 0, `query` |
| `moodle_unit` | `unit` | `unit`*, `section` |
| `moodle_activities` | `activities` | `unit`*, `section`, `section_id`, `include_labels` = false, `limit` = 200, `offset` = 0 |
| `moodle_quiz_show` | `quiz_show` | `unit`*, `activity_id`*, `attempt_id`*, `page` |
| `moodle_due` | `due` | `unit`, `days` = 14, `limit` = 100, `offset` = 0 |
| `moodle_grades` | `grades` | `unit`, `limit` = 100, `offset` = 0, `mode` = "all", `types`, `include_feedback` = true, `include_ungraded` = false |
| `moodle_search_forums` | `search_forums` | `unit`, `query`*, `limit` = 30, `offset` = 0, `forum_id`, `titles_only` = false, `unread_only` = false, `sort` = "recent", `max_forums` = 10, `max_discussions_per_forum` = 20, `include_post_text` = true |
| `moodle_thread` | `thread` | `unit`*, `discussion_id`*, `limit` = 50, `offset` = 0, `post_id`, `include_html` = true |
| `moodle_home` | `home` | `unit`, `days` = 14, `limit` = 100, `alerts_limit` = 5 |
| `moodle_alerts` | `alerts` | `limit` = 100 |
| `moodle_find` | `find` | `unit`, `query`*, `types`, `limit` = 100, `offset` = 0 |
| `moodle_item` | `item` | `unit`*, `activity_id`* |
| `moodle_file` | `file` | `unit`*, `activity_id`*, `file_index` = 0 |
| `moodle_download` | `download` | `unit`*, `activity_id`, `section`, `limit` = 20, `offset` = 0 |
| `moodle_sync` | `sync` | `unit`, `activity_id`, `section`, `limit` = 20, `offset` = 0, `previous_manifest` = [], `dry_run` = false, `known_hashes` = [] |
| `moodle_news` | `news` | `unit`, `limit` = 100, `offset` = 0, `scan_limit` = 100 |
| `moodle_forums` | `forums` | `unit`, `limit` = 100, `offset` = 0 |
| `moodle_forum` | `forum` | `unit`*, `forum_id`*, `query`, `limit` = 100, `offset` = 0 |
| `moodle_attempt` | `attempt` | `unit`*, `activity_id`*, `attempt_id`* |

## ontrack

| Tool | Backend operation | Arguments |
| --- | --- | --- |
| `ontrack_user` | `get_user` | None |
| `ontrack_courses` | `courses` | `limit` = 100, `offset` = 0, `include_inactive` = false |
| `ontrack_unit` | `get_unit` | `unit`* |
| `ontrack_tasks` | `list_tasks` | `unit`*, `limit` = 100, `offset` = 0, `status` |
| `ontrack_task` | `get_task` | `unit`*, `task_definition_id`, `task` |
| `ontrack_roles` | `roles` | `active_only` = true, `limit` = 100, `offset` = 0 |
| `ontrack_unread` | `unread` | `unit`* |
| `ontrack_task_read` | `task_read` | `unit`*, `task_definition_id`, `task`, `page` = 1, `pages` = 200 |
| `ontrack_task_file` | `task_file` | `unit`*, `task_definition_id`, `task`, `resources` = false |
| `ontrack_unit_file` | `unit_file` | `unit`* |

## Beta writes

These tools require `learning:write` and prepare an encrypted preview. Show the preview and obtain explicit user confirmation before `confirm_platform_write` executes it. File tools: `begin_upload`, `upload_chunk`, `finish_upload`, `cancel_upload`. Attendance submission is unavailable.

| Tool | Backend operation | Arguments |
| --- | --- | --- |
| `ed_create_thread` | `create_thread` | `unit`*, `title`*, `body`*, `type` = "question", `category` = "", `anonymous` = false, `private` = false |
| `ed_reply_thread` | `reply_thread` | `unit`*, `thread_id`, `number`, `comment_id`, `body`*, `type`, `anonymous` = false, `private` = false |
| `ed_mark_lessons_read` | `mark_lessons_read` | `unit`*, `lesson_ids`, `queries`, `all` = false, `delay_seconds` = 0 |
| `ed_mark_slide_read` | `mark_slide_read` | `unit`*, `lesson_id`*, `slide_id`* |
| `ed_submit_slide_answer` | `submit_slide_answer` | `unit`*, `lesson_id`*, `slide_id`*, `question_id`*, `choices`*, `amend` = false |
| `ed_submit_slide` | `submit_slide` | `unit`*, `lesson_id`*, `slide_id`* |
| `moodle_submit_assignment` | `submit_assignment` | `unit`*, `activity_id`*, `upload_ids` = [], `final` = false, `replace` = false, `accept_statement` = false |
| `moodle_quiz_start` | `quiz_start` | `unit`*, `quiz_id`*, `password` |
| `moodle_quiz_page` | `quiz_page` | `unit`*, `quiz_id`*, `attempt_id`*, `page`* |
| `moodle_quiz_answer` | `quiz_answer` | `unit`*, `quiz_id`*, `attempt_id`*, `question`*, `value`* |
| `moodle_quiz_finish` | `quiz_finish` | `unit`*, `quiz_id`*, `attempt_id`* |
| `ontrack_chat_history` | `chat_history` | `unit`*, `task`* |
| `ontrack_mark_chat_read` | `mark_chat_read` | `unit`*, `task`* |
| `ontrack_send_chat` | `send_chat` | `unit`*, `task`*, `message`* |
| `ontrack_set_task_state` | `set_task_state` | `unit`*, `task`*, `state`* |
| `ontrack_submit_task` | `submit_task` | `unit`*, `task`*, `upload_ids`*, `type` = "ready_for_feedback", `comment`, `accept_tii_eula` = false |

See [beta write semantics](write-contract.md) for confirmation, uploads, expiry and uncertain outcomes.

See [read semantics and maintenance](read-contract.md) for scope, pagination, file delivery and side-effect boundaries.

## Audited upstream entry points

This is an explicit source-review baseline, not proof of full behavioral equivalence. See [coverage findings and remaining limits](upstream-coverage.md).

### ed

Reviewed commit: `c98b3f93c53f7f94876fdab30635d248a393c5ec`.

| Upstream operation | Suite tools |
| --- | --- |
| get_user | `ed_user` |
| list_courses | `ed_courses` |
| units show | `ed_course` |
| list_lessons | `ed_lessons` |
| get_lesson | `ed_lesson` |
| list_modules | `ed_modules` |
| list_threads | `ed_threads` |
| search_threads | `ed_search_threads` |
| get_thread | `ed_thread` |
| get_course_thread | `ed_course_thread` |
| list_activity | `ed_activity` |
| list_lesson_files | `ed_lesson_files` |
| list_thread_files | `ed_thread_files` |
| files get | `ed_file`, `ed_download` |
| read_thread | `ed_read_thread` |
| read_lesson | `ed_read_lesson` |
| get_slide | `ed_slide` |
| read_slide | `ed_read_slide` |
| list_slide_questions | `ed_slide_questions` |
| list_slide_responses | `ed_slide_responses` |
| mark_lessons_read | `ed_mark_lessons_read` |
| submit_slide_answer | `ed_submit_slide_answer` |
| submit_slide | `ed_submit_slide` |
| create_thread | `ed_create_thread` |
| reply_thread | `ed_reply_thread` |
| show_forum_catchup | `ed_show_forum_catchup` |
| show_thread_activity | `ed_show_thread_activity` |
| show_lesson_progress | `ed_show_lesson_progress` |
| show_lesson_guide | `ed_show_lesson_guide` |

### moodle

Reviewed commit: `fe77b9ce07883650d5a813f4903329d2b6d9e6c5`.

| Upstream operation | Suite tools |
| --- | --- |
| home | `moodle_home` |
| units | `moodle_courses` |
| unit | `moodle_unit` |
| get_user | `moodle_user` |
| list_activities | `moodle_activities` |
| due | `moodle_due` |
| grades | `moodle_grades` |
| find | `moodle_find` |
| item | `moodle_item` |
| file | `moodle_file` |
| download | `moodle_download` |
| sync | `moodle_sync` |
| news | `moodle_news` |
| alerts | `moodle_alerts` |
| list_forums | `moodle_forums` |
| forums show | `moodle_forum` |
| thread | `moodle_thread` |
| search_forums | `moodle_search_forums` |
| attempt | `moodle_attempt` |
| submit | `moodle_submit_assignment` |
| quiz start | `moodle_quiz_start` |
| quiz show | `moodle_quiz_show`, `moodle_quiz_page` |
| quiz answer | `moodle_quiz_answer` |
| quiz finish | `moodle_quiz_finish` |

### ontrack

Reviewed commit: `ea8806ab1b7098c2cc4b365894bcc406c3c386c2`.

| Upstream operation | Suite tools |
| --- | --- |
| user | `ontrack_user` |
| units list | `ontrack_courses` |
| units show | `ontrack_unit` |
| units get | `ontrack_unit_file` |
| tasks list | `ontrack_tasks` |
| tasks show | `ontrack_task` |
| tasks read | `ontrack_task_read` |
| tasks get | `ontrack_task_file` |
| tasks set | `ontrack_set_task_state` |
| tasks submit | `ontrack_submit_task` |
| chats list | `ontrack_unread` |
| chats read | `ontrack_chat_history` |
| chats mark-read | `ontrack_mark_chat_read` |
| chats send | `ontrack_send_chat` |
| roles list | `ontrack_roles` |

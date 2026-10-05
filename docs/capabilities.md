# Read capability reference

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
| `ed_activity` | `list_activity` | `unit`*, `filter_type` = "all", `limit` = 30, `offset` = 0 |
| `ed_modules` | `list_modules` | `unit`* |
| `ed_lesson_files` | `list_lesson_files` | `unit`*, `lesson_id`*, `slide_id` |
| `ed_thread_files` | `list_thread_files` | `unit`*, `thread_id`* |
| `ed_file` | `file` | `unit`*, `lesson_id`, `thread_id`, `slide_id`, `file_index` = 0 |
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
| `moodle_sync` | `sync` | `unit`*, `activity_id`, `section`, `limit` = 20, `offset` = 0, `known_hashes` = [] |
| `moodle_news` | `news` | `unit`, `limit` = 100, `offset` = 0, `scan_limit` = 100 |
| `moodle_forums` | `forums` | `unit`* |
| `moodle_forum` | `forum` | `unit`*, `forum_id`*, `limit` = 100, `offset` = 0 |
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
| `ontrack_task_read` | `task_read` | `unit`*, `task_definition_id`, `task`, `page` = 1, `pages` = 20 |
| `ontrack_task_file` | `task_file` | `unit`*, `task_definition_id`, `task`, `resources` = false |
| `ontrack_unit_file` | `unit_file` | `unit`* |

## Writes awaiting approval

These operations are not exposed or invoked. Attendance submission remains prohibited by repository policy.

### ed

- mark lessons/slides read
- save/amend quiz responses
- submit saved slide responses
- publish threads
- reply to threads/comments

### moodle

- assignment upload/replace/draft/final submit
- quiz start/resume/page navigation/save answers/finish

### ontrack

- read chat history (automatically marks comments read)
- mark chat read
- send chat
- change task state
- submit task files

See [read semantics and maintenance](read-contract.md) for scope, pagination, file delivery and side-effect boundaries.

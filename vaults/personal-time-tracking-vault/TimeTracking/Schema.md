# Activity Tracking Schema

Edit the table below to customize your activity fields.
Changes are saved and applied automatically.

| Field Name    | Type   | Required | Options                                                                                                                                                     | Allow Multiple | Timeline Role | Report Dimension | Aliases                    |
| :------------ | :----- | :------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------- | :------------ | :--------------- | :------------------------- |
| Category      | enum   | Yes      | Deep Work, Shallow Work, Fitness, Learning, Personal, Leisure, Work, Chores, English Learning, Mindfulness & Therapy, Finance, Entertainment, Sleep, Travel | No             | Color         | 1                | activity                   |
| Activity Name | string | Yes      |                                                                                                                                                             | No             | Title         | 2                | task, description          |
| Location      | enum   | No       | Home Office, Office, Coffee Shop, Gym, Transit, Movement_svl, Movement_mtv, Movement_sc, whole_foods, costco, target, cvs, T&T                              | No             | Badge         | 3                | place                      |
| Tags          | string | No       |                                                                                                                                                             | Yes            | Content       |                  | tags                       |
| Notes         | string | No       |                                                                                                                                                             | No             | Content       |                  | linked note                |
| With Who      | enum   | No       | Bob, Alice, Joan, Cindy, Mandy W.                                                                                                                           | Yes            | Content       |                  | with people, collaborators |

## Predefined Activities

| Category | Activities |
| :--- | :--- |
| Deep Work | Coding, Architecture, Code Review, Debugging, Writing |
| Shallow Work | Email, Catch-up, Admin, Status Updates |
| Fitness | Running, Weightlifting, Yoga, Cycling, Walking |
| Learning | Reading, Course, Research |
| Personal | Errand, Meal, Call |
| Entertainment | Gaming, Gaming (birb), Movies, Music |
| Chores | grocery shopping, vacuum cleaned the floor, Cleaning, Laundry, Cooking |
| Travel | Flight, Train, Road Trip, Commute |
| Work | Planning, Meeting, 1:1, Sync |

> [!TIP]
> - **Type**: `enum` or `string`.
> - **Options**: Comma-separated values for `enum` fields. Colors are assigned automatically and stay consistent.
> - **Timeline Role**: `Color` (drives card background/border), `Title` (card heading), `Badge` (pill badge), `Content` (card body text), or `Hidden`.
> - **Report Dimension**: `1`, `2`, or `3` defines the aggregation hierarchy in monthly reports.
> - **Aliases**: Comma-separated historical column names so older monthly records parse without data loss.
> - **Predefined Activities**: First column is Category, second column is candidate activity names. Category doesn't have to be in this table. You can still type other activities freely.

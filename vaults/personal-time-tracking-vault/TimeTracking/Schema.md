# Activity Tracking Schema

Edit the table below to customize your activity fields.
Changes are saved and applied automatically.

| Field Name    | Type   | Required | Options                                                                                                                                      | Allow Multiple | Timeline Role | Report Dimension | Aliases                    |
| :------------ | :----- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------- | :------------- | :------------ | :--------------- | :------------------------- |
| Category      | enum   | Yes      | Deep Work, Shallow Work, Fitness, Learning, Personal, Leisure, Work, Chores, English Learning, Mindfulness & Therapy, Finance, Entertainment | No             | Color         | 1                | activity                   |
| Activity Name | string | Yes      |                                                                                                                                              | No             | Title         | 2                | task, description          |
| Location      | enum   | No       | Home Office, Office, Coffee Shop, Gym, Transit, Movement_svl, Movement_mtv, Movement_sc, whole_foods, costco, target, cvs, T&T               | No             | Badge         | 3                | place                      |
| Tags          | string | No       |                                                                                                                                              | Yes            | Content       |                  | tags                       |
| Notes         | string | No       |                                                                                                                                              | No             | Content       |                  | linked note                |
| With Who      | enum   | No       | Bob, Alice, Joan, Cindy, Mandy W.                                                                                                            | Yes            | Hidden        |                  | with people, collaborators |

> [!TIP]
> - **Type**: `enum` or `string`.
> - **Options**: Comma-separated values for `enum` fields. Colors are assigned automatically and stay consistent.
> - **Timeline Role**: `Color` (drives card background/border), `Title` (card heading), `Badge` (pill badge), `Content` (card body text), or `Hidden`.
> - **Report Dimension**: `1`, `2`, or `3` defines the aggregation hierarchy in monthly reports.
> - **Aliases**: Comma-separated historical column names so older monthly records parse without data loss.

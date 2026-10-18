Run brief-desk in autonomous mode.
source=auto

Goal: {{goal}}

Tool sequence (strict):
1) If brief_auto exists → call it once with this goal.
2) Else → brief_plan once, then brief_orchestrate once with invented fields.
3) Draft from gather only.
4) brief_eval. Revise if pass=false. Reply with the brief.

Do not wait for the left panel.
{{hints}}

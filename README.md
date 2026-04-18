# 强智教务成绩推送系统

QZCheckScores 是一个面向强智教务系统的成绩变动监测工具。(目前仅支持山东农业大学，其他学校不确定)  
它会定时登录教务系统拉取成绩，当检测到成绩变化时，通过 ShowDoc 推送到微信。

## 功能说明

1. 自动登录山东农业大学教务系统（`jw.sdau.edu.cn`）
2. 拉取指定学期成绩（或按日期自动推断学期）
3. 按 A/B 双文件 + MD5 规则判断是否更新
4. 首次运行自动推送“程序启动成功”通知
5. 后续仅在成绩变化时推送“教务系统成绩已更新”
6. 支持手动强制推送测试（`--force-push`）
7. 推送内容包含：
   - 学期
   - 个人信息（姓名、学号、班级、学院）
   - 本学期GPA
   - 总GPA（来自教务汇总接口）
   - 每门课成绩（含平时成绩、期末成绩、学分）

## 核心判定逻辑（A/B 文件）

程序使用两个文件：

1. `Hash_New.txt`（A）
2. `Hash_Origin.txt`（B）

每次运行流程如下：

1. 清空 B
2. 将 A 的旧内容写入 B
3. 清空 A
4. 将本次成绩内容做 MD5
5. 将 MD5 写入 A
6. 比对 A 与 B 是否一致

结论：

1. 一致：成绩未更新
2. 不一致：成绩已更新（触发推送）

说明：

1. 首次运行（A/B 都为空）会按上述流程执行两遍，然后发送一次“程序运行成功”通知。

## 使用方法(GitHub部署)

### 1. [Fork](https://github.com/Sleexycg/QZCheckScores/fork "Fork") 本仓库

`Fork` → `Create fork`

### 2. 开启 工作流读写权限

`Settings` → `Actions` → `General` → `Workflow permissions` →`Read and write permissions` →`Save`

### 3. 获取 Showdoc URL
关注微信公众号'showdoc推送服务'会自动收到专属推送地址，格式为`https://push.showdoc.com.cn/..`

### 4. 添加 Secrets

`Settings` → `Secrets and variables` → `Actions` → `Secrets` → `Repository secrets` → `New repository secret` → `Add secret`

| Name     | 例子                   | 说明                                                                      |
| -------- | ---------------------- | ------------------------------------------------------------------------- |
| JW_BASE_URL      | https://jw.sdau.edu.cn              | 教务系统地址(选填)                                                             |
| JW_STUDENT_ID | 2024114514                             | 教务系统账号                                                                   |
| JW_PASSWORD   | test                                   | 教务系统密码                                                                   |
| SHOWDOC_PUSH_URL    | https://push.showdoc.com.cn/..   | [Showdoc 的 地址](https://push.showdoc.com.cn/#/push "Showdoc 的 push地址")    |
| WATCH_TERM   | 2025-2026-2                             |  学期                                                                         |

### 5. 开启 Actions

`Actions` → `I understand my workflows, go ahead and enable them` → `CheckScores` → `Enable workflow`

### 6. 运行 程序

`Actions` → `CheckScores` → `Run workflow`

_若你的程序正常运行且未报错，那么在此之后，程序将会每隔 30 分钟自动检测一次成绩是否有更新_

## 本地部署
1. 下载本项目
2. 新建.env.local文件，在里面输入：
   ```env
   JW_BASE_URL=https://jw.sdau.edu.cn
   JW_STUDENT_ID=你的学号
   JW_PASSWORD=你的密码
   SHOWDOC_PUSH_URL=https://push.showdoc.com.cn/server/api/xxxx
   WATCH_TERM=2024-2025-1```
3. 在终端中打开项目，输入`node main.mjs`

## 其他命令

1. 强制推送测试：`node main.mjs --force-push`
2. 开启调试：`DEBUG_LOGIN=1 node main.mjs --force-push`

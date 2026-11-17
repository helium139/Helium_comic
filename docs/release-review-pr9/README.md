# PR #9 — gói review phát hành, chưa thực hiện production

Runtime candidate: **b486a029**. Baseline repository: **4955c7ca**.
Không dùng PR #7. PR #7 tiếp tục draft; pilot authority cũ giữ tắt và không đổi
journal/reservation. MongoDB đã hủy. Chưa merge/deploy, tạo lab hoặc ghi quyền.

## 1. CMS source/version

**Chưa có export active CMS.** Lần đọc GET script helium-cms đã trả 403 với token
preflight; không có thay đổi credential được thông báo, nên không gọi lặp lại cùng
request. Không thay token CMS/R2 hay yêu cầu quyền edit để làm bước đối chiếu này.
Version ID, traffic versions, preview URLs và sự khác biệt live-vs-baseline còn
CHƯA XÁC MINH. Không được dùng trạng thái Pages success để thay bằng chứng này.

`cms-source-manifest.json` liệt kê SHA256 của toàn bộ module ứng dụng và dependency
lock/config liên quan. Hash source chuẩn hóa LF, khác hash raw export/bundle.
Đây là **repository baseline → candidate**, không phải đã xác nhận live:

| File | Khác biệt |
|---|---|
| worker/source/worker.js | Kiểm tra grant mới ở đầu cả 8 mutations; recheck cả 3 catalogue-save paths |
| worker/source/firebase-auth.js | Trả thêm accessVersion từ JWT đã xác minh |
| worker/source/current-access.js | Thêm đọc grant Firestore bằng ID token người gọi; giới hạn 8KiB/5s, fail closed |
| functions/lib/access/policy.mjs | Thêm so sánh role/team/version/state dùng chung |
| chapter-promotion, cms-authorization, image-format, admin-picks-order | Không đổi |
| worker package/lock và wrangler.toml | Không đổi; không nâng plan/binding R2 |

Chưa thể liệt kê mọi khác biệt của **live** khi chưa có source đó. Đây là blocker,
không phải kết luận live chỉ khác bốn file trên.

### Lấy export đúng từ dashboard

1. Workers & Pages → **helium-cms → Deployments**, chọn deployment đang nhận traffic.
2. Ghi full deployment ID, version ID, thời điểm, phần trăm traffic của TỪNG version.
   Nếu nhiều version đang nhận traffic, cần export từng version. Ghi routes/custom
   domains, workers.dev và preview URL trạng thái để không bỏ sót đường ghi cũ.
3. **Edit code** đúng version đã chọn; export/download các module, không Save/Deploy.
   Nếu UI chỉ cho copy, lưu riêng từng file và tên entrypoint. Bundle thì gửi bundle
   cùng thông tin build/tool version nếu có; không chỉ ảnh một đoạn code.
4. Không xuất tab Variables/Secrets; binding chỉ cần tên/type và bucket/repository
   đích không nhạy cảm. Không gửi GITHUB_TOKEN, API token, OAuth hay private key.
   Nếu mã cũ hardcode credential, che giá trị trước khi chia sẻ và nói rõ đã che.
5. Giữ file raw private; chạy Get-FileHash SHA256 để nhận diện đúng export. Đối chiếu
   source module với manifest; bundle phải reproduce đúng build flags/tool version.
   Mismatch chưa giải thích hoặc thiếu version đang nhận traffic = chưa deploy.

## 2. Bootstrap dry-run (private evidence, zero production writes)

Đã đọc một trang Auth tối đa 200 records, chỉ giữ staff UID/role/team/version/
disabled; không giữ email, token hay dữ liệu người đọc. Có nextPageToken nên chưa
chứng minh không có claim-only staff ngoài trang đó. Query profile staff tối đa 21
trả ba UID, chưa chạm giới hạn. Một UID được lookup Auth trực tiếp để đối soát,
không tiếp tục phân trang user. Grants của ba UID và slot team liên quan đều 404.

Private files (Git ignored, không commit UID thật):
- `.local-cms-build/staff-observed.private.json`: snapshot chỉ đọc, thời điểm UTC.
- `.local-cms-build/staff-bootstrap-plan.private.json`: exact UID/role/team/version,
  hành động dự kiến và blockers. Người dùng có bảng UID đầy đủ trong phản hồi riêng.

Offline planner chỉ đọc JSON và ghi manifest private LOCAL, không import Firebase
SDK, không network, không có apply mode:
`node scripts/staff-bootstrap-dry-run.mjs .local-cms-build/staff-observed.private.json .local-cms-build/staff-bootstrap-intent.private.json`

Hiện có một enabled admin Auth/profile khớp và một leader testteam khớp, đề xuất
version **1**, không đổi role/team. Chủ dự án đã xác nhận UID có profile admin/Auth
user là tài khoản admin mong muốn của mình. Manifest đề xuất repair claims admin
version1, gắn cờ cần duyệt thay quyền riêng; không coi đây đã là admin hoặc backup
trước ACK. Không có hai leader testteam trong roster đã xác minh. Dự kiến sau repair
có hai admin, hiện chỉ một admin có claims đã xác minh. Không tạo tài khoản mới.

Dry-run **chưa ready** vì phạm vi Auth chưa đóng. Ý định repair được ghi riêng,
không sửa Auth quan sát. Cần xác nhận roster đầy đủ hoặc UID staff còn thiếu để lookup đích;
không cần gửi secrets hoặc scan events. Ngoài allowlist sẽ mặc định không có grant
khi guards mới hoạt động; phải chấp nhận rõ ảnh hưởng này trước bootstrap.
Không sửa dữ liệu quan sát để giả vờ Auth pagination đã hoàn tất.

Planner chặn: mất admin, tài khoản disabled, team inactive/không tồn tại, hai leader
cùng team, slot đã có owner khác, quyền hiện có pending/không nhất quán hoặc version
đã xuất hiện nhưng grant thiếu. Grant active nhất quán là no-op, không bump lại.

## 3. Thứ tự triển khai cần duyệt riêng

0. Đóng provenance CMS, roster, Free CPU/transport gates, backup metadata và artifact
   của từng surface. Chốt IAM operator có khả năng phục hồi admin. Lên staff-only
   maintenance, ngừng thay quyền và không nhận upload/publish mới. Cô lập mọi CMS
   route/workers.dev/preview cũ; không sửa/xóa R2 hoặc chặn website đọc tĩnh.
1. **Bootstrap admin trước** bằng manifest đã duyệt: seed pending grant version1,
   giữ nguyên role/team và unrelated claims, set claims/profile cùng version, đọc
   ACK rồi active. Xác nhận ít nhất một admin versioned còn hoạt động và refresh
   phiên của người đó TRƯỚC khi chuyển Rules/API sang chế độ yêu cầu version. Đây
   là cách tránh khóa mất admin. Không bootstrap admin chỉ dựa profile.
2. Bootstrap staff hợp lệ còn lại tương tự (giữ role/team, reserve leader slot một
   cách transactional). Chưa repair UID Auth user/profile admin ở bước giữ quyền
   này. Nếu bootstrap lỗi: giữ pending,
   phục hồi bằng operator; không mở maintenance hoặc xóa grant để che lỗi.
3. **Functions**: deploy riêng 11 adapters đã đổi: setUserAccess,
   getChapterViewAnalytics, getMonthlyViewDashboard, getMonthlyViewReports,
   generateMonthlyViewReport, retryMonthlyViewReport, listComments, createComment,
   editComment, deleteComment, moderateComment. Không deploy Start/Record A,
   popularity hoặc scheduler chỉ vì dùng chung codebase. Kiểm tra revision/traffic
   thực tế và không để URL/tag/revision cũ còn đường gọi đặc quyền.
   Sau khi Functions mới active và riêng repair được duyệt, admin versioned hiện
   hữu dùng setUserAccess cho UID owner: role admin, expectedVersion0, UUID mới;
   pending/ACK/active version1. Nếu lỗi giữ admin đầu và retry cùng ID; không gọi
   script bootstrap cũ hoặc coi đã có admin thứ hai trước khi ACK.
4. **Rules**: phát hành ruleset đã kiểm thử, xác minh release/source và propagation
   trước mở staff. Own staffAccess get được phép; stale grants và mọi browser write
   vào authority/slot/audit bị chặn. Readers/comments/history/view ledger giữ nguyên.
5. **CMS**: giữ endpoint đóng khi upload artifact đã đối chiếu, giữ Workers Free,
   bindings CMS/R2 đích cũ không đổi. Xác minh tất cả traffic chỉ tới bản guarded;
   không để preview hoặc version URL cũ bypass. Không dùng production mutations
   để benchmark. Endpoint chỉ mở sau các gate dưới đây được xác nhận.
6. **Frontend**: PR không đổi runtime frontend/adapter; không có migration UI hay
   cutover API. Pages merge không deploy Functions/Rules/CMS. Sau backend hoàn tất,
   staff refresh token/đăng nhập lại, xác nhận version/profile; tab cũ không thể
   thay thế backend grant check. Giữ PWA/Auth/comments/đọc truyện.
7. Mở lại staff theo từng người sau khi admin đã được xác nhận, không tạo team thật
   hoặc đổi thêm role trong gói này. Đối soát bất biến view lịch sử, không ghi view
   giả vào production để thử. Mọi bước thực thi cần duyệt, hiện chỉ là runbook.

Trong khoảng mixed-version vẫn có thể còn lỗ hổng của baseline trên surface chưa
đổi. Không tuyên bố thu hồi toàn hệ thống đã hoạt động hoặc kết thúc maintenance
trước khi ALL surfaces/rules/route cũ được xử lý. Request đã được admit trước fence
có thể hoàn tất; không có transaction GitHub/R2/Firestore chung.

### Rollback tương thích

- Không rollback về Worker baseline, Rules cũ hoặc Functions chỉ kiểm tra claims.
  Giữ artifact guarded b486a029 làm nền; revert logic ngoài quyền chỉ được phép nếu
  giữ fresh authority/version checks và tests stale-token đạt.
- Nếu lỗi quyền/transport: đóng staff writes, giữ guards fail closed; public đọc,
  Auth và view A giữ nguyên. Sửa/roll forward, không bật fallback quyền cache.
- Giữ staffAccess, version, operation, audit và slot. Không decrement version/xóa
  grant. Đổi lại role/team cần một change mới expectedVersion hiện tại và UUID mới,
  qua barrier/ACK; retry operation pending dùng đúng ID cũ.
- Auth RPC rất muộn có thể gây projection drift: không tăng quyền được vì version
  cũ vẫn bị chặn; xử lý inconsistent theo runbook. Operator mất/xóa user hoặc hết
  admin cần phục hồi IAM được duyệt riêng, không gọi legacy script đã nghỉ.
- Không đổi ownership lịch sử, di chuyển event/aggregate, xóa Function hoặc ledger.

## 4. Phép đo CPU cô lập đề xuất, chưa chạy/tạo tài nguyên

Chi tiết máy đọc được: `cpu-workload.json`. Đây là đề nghị ngân sách MỚI, không
reset/hoàn counters hoặc reservation của authority pilot cũ.

Đề xuất **hai Workers Free + một R2 bucket lab tạm**, không D1/Google project,
không domain/routes production, không credential production. Candidate chạy source
CMS thật cùng JWT crypto/version/role checks; provider mock Google/GitHub chạy ở
Worker riêng để CPU parse/base64/CAS fixture không bị tính nhầm là CPU CMS. Cả hai
vẫn chung quota account, không có thêm daily allowance nhờ tách Worker.

R2 lab dùng binding thật để đo đường stream/read/hash/upload, KHÔNG bucket
helium-comic. Đây là tài nguyên đề xuất cần duyệt, không đổi gói R2 hiện hữu.
Google/Firestore/GitHub mock; tuyệt đối không gọi production. Synthetic JWT không
dùng khóa/tokens Firebase thật nhưng phải xác minh RS256/issuer/audience/time và
grant như runtime. Provider phải giữ conditional CAS và trả 409 đúng khi tranh
catalogue; không cho tất cả publish thành công giả để có latency đẹp.

| Phase | Candidate HTTP attempts tối đa | Mục đích |
|---|---:|---|
| 3 upload tuần tự | 3 | First invocation và hai warm, ảnh 0.8MiB |
| 3 publish 30 ảnh, deployment mới cùng code | 3 | First invocation và hai warm |
| Bốn team | 8 | 4 upload song song, 4 publish song song |
| 2x | 16 | 8 upload rồi 8 publish: hai tab mỗi leader, vẫn chỉ 4 leaders |
| **Tổng candidate** | **30** | Không retry/bù mẫu |

Fixture current mô phỏng 41 manga/599 chapters/591,478 byte bằng nội dung giả.
Sau 30 ngày: +600 chương cho tổng bốn team →1199; 2x +1200→1799. Giả định thêm
9 manga cho ba team mới, 50 tổng; catalogue tối thiểu 1.25MB/1.9MB. Đây là mô hình,
không phải đã đo nội dung thực. Mỗi chương 30 ảnh 0.8MiB; purge/verify dữ liệu lab
giữa phases để peak <=512MiB. Chưa chạy mới các test catalogue/upload ngoài phạm
vi thay đổi này; correctness CMS/view hiện có và PR CI trước đó đã đạt.

Ngân sách đề xuất: <=230 Worker invocations cộng cả provider (30+200), <=36 control
calls, trong đó 7 dự phòng cleanup; R2 <=1500 Class A, <=4000 Class B, <=1000 objects,
<=512MiB, guard 20 phút. Tất cả setup uploads, GET/HEAD/PUT/list và cleanup đều
tính vào caps phù hợp; thêm cap 1500 DELETE dataplane, tách khỏi control-plane.
DELETE free về giá không có nghĩa được bỏ khỏi journal.
Preflight account/Free/daily quota/logs trước tạo; thiếu quyền hay quota thì dừng,
không nâng Paid. Hai deployments candidate để lấy first-invocation evidence đã
tính trong trần control; không tạo thêm Worker để bù cold sample.

Không gọi readiness trên candidate trước sample first-invocation; readiness ở đây
là kiểm chứng control-plane artifact/version/config và fixture local. Đây là thay
đổi đề xuất cần duyệt cho lab hoàn toàn giả, không tiếp tục controller cũ. HTTP
response đầu phải khớp fingerprint/schema; sai thì dừng, không phát lại. Nếu sau
này yêu cầu HTTP readiness trước workload, sample tiếp theo phải coi đã có khả
năng warm; không gọi nó là cold để đủ bảng.

Ghi invocation **cpuTimeMs từng request**, latency riêng; tag version/fingerprint,
request ID, isolateTag và firstInvocation. Key-cache cold không đồng nghĩa isolate
cold. Module-first có bằng chứng vẫn không tự chứng minh toàn bộ platform startup
CPU; thiếu true-cold evidence thì báo chưa đo, không thêm request bù. Không suy
p95 từ 3 mẫu. Không lấy hiệu hai isolate/cache state làm overhead chính xác.

Mục tiêu headroom: từng warm sample <=5ms, cold/largest branch <=7ms; không dùng
trung bình để che một nhánh xấu. Phase serial không đạt mục tiêu này thì dừng trước
phép thử đồng thời; >=10ms là hard stop. Cần account normal target <=70k/day để
chừa 30% quota, chưa phải daily usage đã đo. Không biến Free limit thành mục tiêu sát trần.

Invocation logs sampling 100% phải được kiểm tra config thực, không chỉ gửi option
lúc deploy; join được EVERY sample với CPU trace. Bốn queries logs giới hạn tương
ứng phases, không phát workload tiếp nếu phase trước thiếu traces, có branch
>=10ms, quota/transport/schema/correctness lỗi. Provider CPU cũng phải trong Free;
provider lỗi → inconclusive, không tự quy lỗi cho CMS. Không đổi cấu hình CPU.

Provider có thể nhiều 409 đúng do global catalogue CAS. Đó là kết quả contention,
không phải mẫu cần thay hoặc bằng chứng mất chương. Correctness đối soát catalogue
trước/sau, staging và tất cả team prefixes; mọi request ghi có outcome không rõ
phải giữ journal, không tự replay.

CPU pass của lab chưa chứng minh Auth/App Check/Firestore thật, IAM hoặc sustained
production load. Real transport/Free daily headroom vẫn là gate riêng; không dùng
widget CPU tổng hợp. Giới hạn Free là 10ms CPU/request và100k requests/ngày account.

### Chi phí một lần và cleanup đề xuất

Workers Free không subscription. Không dùng credits để tính rẻ. Với giả định mọi
R2 allowance đã dùng: 1500 A ~$0.00675, 4000 B ~$0.00144; dự phòng một GB-month
làm tròn ~$0.015 cho lab lưu ngắn hạn. Tổng kế hoạch <=$0.024 trước thuế/FX; đề nghị
dự phòng **$0.05 một lần**, không phải phí tháng hoặc hard billing cap. Giá tại
https://developers.cloudflare.com/r2/pricing/ cần đối chiếu lại trước thực thi.

Trong finally luôn tắt workers.dev/previews candidate và xác minh false. Provider
không có public endpoint. Chỉ dọn hai tên Worker/bucket lab trong manifest: list
keys lab có giới hạn, xóa từng key đã tạo, xác minh bucket rỗng rồi xóa bucket và
Workers nếu phạm vi dọn được duyệt; kiểm tra 404 của đúng resource IDs. Giữ journal
và báo ngay nếu tắt/dọn chưa xác minh. Không dùng wildcard, không xóa bucket/Worker
CMS hoặc dữ liệu dùng chung. Không tài nguyên nào trong đề xuất đã được tạo.

## 5. Điều kiện còn thiếu

1. Export/version/traffic/routing CMS live và diff đã giải thích đầy đủ.
2. Xác nhận roster allowlist đầy đủ. Ý định repair admin đã ghi nhận nhưng thực thi
   vẫn cần duyệt; manifest còn BLOCKED do coverage, chưa có quyền ghi/apply.
3. Operator/manifest/bootstrap và maintenance/rollback package được duyệt.
4. Daily quota/logs/account Free preflight cho lab, quyền lab scoped và gói tài
   nguyên/workload/chi phí được duyệt; chưa chạy CPU cloud.
5. CPU evidence toàn bộ mẫu, cold-state đúng và capacity trên tải giả; sau đó còn
   real Firestore/Auth/App Check transport compatibility, không dùng mock pass thay.
6. Chỉ mở staff production khi Rules/Functions/CMS guarded đồng nhất; không đưa
   team thật vào gói review này và không khôi phục lỗ hổng khi rollback.

Control-plane breakdown: 4 preflight +1 bucket create +3 uploads (provider/v1/v2)
+6 effective settings/version proofs +2 provider disable/verify +1 candidate open
+4 logs queries +2 finally close/verify +6 exact-resource delete/verify =29;
7 calls reserved for cleanup failures -> cap36. Object dataplane requests are
separate and count in the stated R2 caps, not hidden as control-plane.

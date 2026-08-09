const api = globalThis.browser ?? globalThis.chrome;

const webhookUrlEl = document.getElementById('webhookUrl');
const secretEl = document.getElementById('secret');
const userEmailEl = document.getElementById('userEmail');
const saveBtn = document.getElementById('saveBtn');
const savedEl = document.getElementById('saved');

async function load() {
  const data = await api.storage.sync.get(['webhookUrl', 'secret', 'userEmail']);
  webhookUrlEl.value = data.webhookUrl || '';
  secretEl.value = data.secret || '';
  userEmailEl.value = data.userEmail || '';
}

saveBtn.addEventListener('click', async () => {
  await api.storage.sync.set({
    webhookUrl: webhookUrlEl.value.trim(),
    secret: secretEl.value.trim(),
    userEmail: userEmailEl.value.trim(),
  });
  savedEl.hidden = false;
  setTimeout(() => {
    savedEl.hidden = true;
  }, 2000);
});

load();

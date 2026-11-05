<script>
  let { checked = false, label, onchange } = $props();
</script>

<button type="button" role="switch" aria-checked={checked} aria-label={label}
        class="switch" class:on={checked} onclick={() => onchange?.(!checked)}>
  <span class="knob"></span>
</button>

<style>
  .switch {
    position: relative; flex-shrink: 0;
    width: 46px; height: 26px; padding: 0;
    border: none; border-radius: 99px;
    background: var(--border-strong);
    transition: background .15s;
  }
  .switch.on { background: var(--accent); }
  .knob {
    position: absolute; top: 3px; left: 3px;
    width: 20px; height: 20px; border-radius: 50%;
    background: #fff; transition: left .15s;
  }
  .on .knob { left: 23px; }
</style>

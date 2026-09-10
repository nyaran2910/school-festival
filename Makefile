.DEFAULT_GOAL := local

export DOMAIN

.PHONY: local up stop down restart logs status production production-down production-logs production-status configure controller receiver controller-build receiver-build monitor controller-monitor receiver-monitor list test

local up stop down restart logs status production production-down production-logs production-status configure:
	@$(MAKE) --no-print-directory -C apps/PhoneControllerSignal $@

controller receiver controller-build receiver-build monitor controller-monitor receiver-monitor list test:
	@$(MAKE) --no-print-directory -C apps/kosen-chanbara-controller $@
